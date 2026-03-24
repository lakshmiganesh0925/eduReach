import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { SystemMessage } from "@langchain/core/messages";
import {
  ChatGoogleGenerativeAI,
  GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";
import { MongoDBAtlasVectorSearch } from "@langchain/mongodb";
import { TextLoader } from "@langchain/classic/document_loaders/fs/text";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Document } from "@langchain/core/documents";
import { z } from "zod";

// ---- __dirname for ESM ----
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- MongoDB native client ----
let mongoClient: MongoClient | null = null;

const getMongoClient = async (): Promise<MongoClient> => {
  if (!mongoClient) {
    const uri = process.env.MONGODB_URI;
    if (
      !uri ||
      (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://"))
    ) {
      throw new Error(
        "❌ MONGODB_URI is missing or invalid in .env — must start with mongodb:// or mongodb+srv://"
      );
    }
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    console.log("✅ MongoDB connected");
  }
  return mongoClient;
};

// ---- Google GenAI Embeddings ----
const getEmbeddings = (): GoogleGenerativeAIEmbeddings => {
  if (!process.env.GOOGLE_API_KEY) {
    throw new Error("❌ GOOGLE_API_KEY is not set in .env!");
  }
  return new GoogleGenerativeAIEmbeddings({
    apiKey: process.env.GOOGLE_API_KEY,
    model: "gemini-embedding-001", // ✅ correct model name
  });
};

// ---- Vector Store ----
const getVectorStore = async (): Promise<MongoDBAtlasVectorSearch> => {
  const client = await getMongoClient();
  const collection = client.db("edureach_db").collection("knowledge_docs");

  return new MongoDBAtlasVectorSearch(getEmbeddings(), {
    collection: collection as any,
    indexName: "edureach_vector_index",
    textKey: "text",
    embeddingKey: "embedding",
  });
};

// ============================================
// A) INDEXING — runs ONCE at server startup
// ============================================
export const initializeKnowledgeBase = async (): Promise<void> => {
  const client = await getMongoClient();
  const collection = client.db("edureach_db").collection("knowledge_docs");

  // Check if docs already exist with valid embeddings
  const docWithEmbedding = await collection.findOne({
    embedding: { $exists: true, $not: { $size: 0 } },
  });

  if (docWithEmbedding) {
    const count = await collection.countDocuments();
    console.log(`✅ Knowledge base ready (${count} chunks with embeddings)`);
    return;
  }

  // If docs exist but embeddings are empty → delete and re-index
  const existingCount = await collection.countDocuments();
  if (existingCount > 0) {
    console.log(
      `⚠️  Found ${existingCount} chunks with EMPTY embeddings — deleting & re-indexing...`
    );
    await collection.deleteMany({});
  }

  console.log("📚 Indexing knowledge base...");

  // Verify API key FIRST with a test embedding
  const embeddings = getEmbeddings();
  try {
    const testResult = await embeddings.embedQuery("test");
    console.log(`✅ API key OK — embedding dimensions: ${testResult.length}`);
  } catch (error: any) {
    console.error("❌ Embedding test failed!");
    console.error("   Error:", error.message || error);
    console.error("   Get key from: https://aistudio.google.com/apikey");
    throw error;
  }

  // LOAD knowledge base file
  const filePath = path.join(
    __dirname,
    "../../knowledge-base/edureach-knowledge.txt"
  );
  const loader = new TextLoader(filePath);
  const docs: Document[] = await loader.load();

  if (docs.length === 0) {
    throw new Error("❌ No documents found in knowledge base file");
  }

  const totalCharacters = docs.reduce(
    (sum: number, doc: Document) => sum + doc.pageContent.length,
    0
  );
  console.log(`   📄 Loaded ${totalCharacters} characters`);

  // SPLIT into chunks
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });
  const allSplits: Document[] = await splitter.splitDocuments(docs);
  console.log(`   ✂️  Split into ${allSplits.length} chunks`);

  // EMBED + STORE in MongoDB
  const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
    collection: collection as any,
    indexName: "edureach_vector_index",
    textKey: "text",
    embeddingKey: "embedding",
  });

  await vectorStore.addDocuments(allSplits);

  // VERIFY embeddings were stored
  const verifyDoc = await collection.findOne({
    embedding: { $exists: true, $not: { $size: 0 } },
  });

  if (
    verifyDoc &&
    Array.isArray(verifyDoc.embedding) &&
    verifyDoc.embedding.length > 0
  ) {
    console.log(
      `✅ ${allSplits.length} chunks stored (${verifyDoc.embedding.length}D embeddings)`
    );
    console.log(
      `⚠️  IMPORTANT: Create Atlas Vector Search index with numDimensions: ${verifyDoc.embedding.length}`
    );
  } else {
    await collection.deleteMany({});
    throw new Error("❌ Embeddings are empty! Google API returned no vectors.");
  }
};

// ============================================
// B) RETRIEVE TOOL
// ============================================
const createRetrieveTool = (vectorStore: MongoDBAtlasVectorSearch) => {
  return tool(
    async ({ query }: { query: string }): Promise<string> => {
      console.log("🔍 Retrieving docs for:", query);
      const retrievedDocs = await vectorStore.similaritySearch(query, 3);
      if (retrievedDocs.length === 0) {
        return "No relevant information found in the knowledge base.";
      }
      return retrievedDocs
        .map(
          (doc: Document) =>
            `Source: ${doc.metadata.source}\nContent: ${doc.pageContent}`
        )
        .join("\n\n");
    },
    {
      name: "retrieve",
      description:
        "Retrieve information from the EduReach College knowledge base. " +
        "Use this for any questions about courses, fees, admissions, mentors, campus, placements.",
      schema: z.object({ query: z.string() }),
    }
  );
};

// ============================================
// C) RAG AGENT — runs on every chat query
// ============================================
export const getRAGResponse = async (question: string): Promise<string> => {
  try {
    console.log("1️⃣  RAG called with:", question);

    const vectorStore = await getVectorStore();
    console.log("2️⃣  Vector store connected");

    const retrieve = createRetrieveTool(vectorStore);

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0.7,
    });

    // ✅ createReactAgent from @langchain/langgraph/prebuilt
    const agent =  createReactAgent({
      llm: model,
      tools: [retrieve],
    });

    console.log("3️⃣  Agent created, invoking...");

    const result = await agent.invoke({
      messages: [
        // ✅ system prompt passed as SystemMessage
        new SystemMessage(
          "You are EduReach Bot, a helpful AI counselor for EduReach College, Hyderabad. " +
            "ALWAYS use the retrieve tool to search the knowledge base before answering. " +
            "Be concise, friendly, and professional. " +
            "If the information is not found, say: " +
            "'I don't have that information right now. Click Talk to Us to speak with a counselor.'"
        ),
        { role: "user", content: question },
      ],
    });

    console.log(`4️⃣  Agent finished ${result}` );

    const messages = result.messages;
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return "I couldn't generate a response. Please try again.";
    }

    return typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
  } catch (error) {
    console.error("❌ RAG Agent Error:", error);
    return "I'm having trouble right now. Please try again or click 'Talk to Us'.";
  }
};