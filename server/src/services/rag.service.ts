import path from 'path';
import { fileURLToPath } from 'url';
import {MongoClient} from 'mongodb';
import {createAgent,tool} from "langchain";
import {
    ChatGoogleGenerativeAI,
    GoogleGenerativeAIEmbeddings,
} from "@langchain/google-genai";
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { TextLoader } from '@langchain/classic/document_loaders/fs/text';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import {z} from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mongoClient: MongoClient | null =null;

const getMongoClient =async():Promise<MongoClient>=>{
    if(!mongoClient){
        mongoClient=new MongoClient(process.env.MONGO_URI || "");
        await mongoClient.connect();
    }
    return mongoClient;
}

const getEmbeddings = ()=>{
    if(!process.env.GOOGLE_API_KEY){
        throw new Error("GOOGLE_API_KEY is not set");
    }
    return new GoogleGenerativeAIEmbeddings({
        apiKey:process.env.GOOGLE_API_KEY,
        model:"gemini-embeddings-001",
    })
}

const getVectorStore = async()=>{
    const client =await getMongoClient();
    const collection =client.db('edureachDB').collection('knowledge_docs');

    return new MongoDBAtlasVectorSearch(getEmbeddings(),{
        collection:collection as any,
        indexName:"edureach_vector_index",
        textKey:"text",
        embeddingKey:"embedding",
    });
};

export const initializeKnowledgeBase = async():Promise<void>=>{
   const client= await getMongoClient();
   const collection = client.db('edureachDB').collection('knowledge_docs');

   const docsWithEmbeddings = await collection.findOne({
    embedding:{$exists:true,$not:{$size:0}},
   })

   if(docsWithEmbeddings){
    const count=await collection.countDocuments();
    console.log(`Knowledge base ready (${count} chunkswith embeddings)`)
    return;
   }
  
   const existingCount = await collection.countDocuments();
    if(existingCount>0){
        console.log(`Found ${existingCount} chunks with empty embeddings - deleting &re-indexing...` );
        await collection.deleteMany({});
    }
    console.log("Indexing knowledge base...");

    const embeddings= getEmbeddings();
    try{
        const testResult = await embeddings.embedQuery("test");
        console.log(`API Key OK -embedding dimensions : ${testResult.length}`);
    }catch(error :any){
        console.error("Embedding test failed!");
        console.error(" Error :", error.message || error);
        console.error("Get key from : https://aistudio.google.com/apikey.");
        throw error;
    }  

    const filePath = path.join(__dirname,"../../knowledge-base/edureach-knowledge.txt");
    const loader = new TextLoader(filePath);
    const docs = await loader.load();
    if(docs.length===0){
        throw new Error("No documents found in knowledge base file");
    }
    const totalCharacters = docs.reduce((sum,doc)=>sum+doc.pageContent.length,0);
    console.log(`Loaded ${docs.length} documents with total ${totalCharacters} characters.`);

    const splitter = new RecursiveCharacterTextSplitter({
        chunkSize:1000,
        chunkOverlap:200,
    });

    const allSplits = await splitter.splitDocuments(docs);
    console.log(`Split into ${allSplits.length} chunks.`);

    const vectorStore = new MongoDBAtlasVectorSearch(
        embeddings,
        {
            collection:collection as any,
            indexName:"edureach_vector_index",
            textKey:"text",
            embeddingKey:"embedding",
        }
    );
    await vectorStore.addDocuments(allSplits);

    const verifyDoc = await collection.findOne({
        embedding:{$exists:true,$not:{$size:0}},
    })

    if (verifyDoc && Array.isArray(verifyDoc.embedding) && verifyDoc.embedding.length > 0) {
    console.log(`    ${allSplits.length} chunks stored (${verifyDoc.embedding.length}D embeddings)`);
    console.log(`     IMPORTANT: Create Atlas Vector Search index with numDimensions: ${verifyDoc.embedding.length}`);
  } else {
    await collection.deleteMany({});
    throw new Error(" Embeddings are empty! Google API returned no vectors.");
  }
}

const createRetrieveTool = (vectorStore:MongoDBAtlasVectorSearch)=>{
   return tool(
    async ({query}:{query:string})=>{
        const retrievedDocs = await vectorStore.similaritySearch(query,5);
        return retrievedDocs.map((doc)=>`Source:${doc.metadata.source}\nnContent: ${doc.pageContent}`)
        .join("\n\n");
    },{
        name:"retrieve_knowledge",
        description:"Useful for retrieving relevant information from the knowledge base to answer user queries. Input is a natural language query, output is the retrieved text chunks.",
        schema:z.object({
            query:z.string()
        })
    }
   );
};


export const getRAGResponse = async (question: string): Promise<string> => {
  try {
    const vectorStore = await getVectorStore();
    const retrieve = createRetrieveTool(vectorStore);

    const model = new ChatGoogleGenerativeAI({
      model: "gemini-2.5-flash",
      temperature: 0.7,
    });

    const agent = createAgent({
      model,
      tools: [retrieve],
      systemPrompt:
        "You are EduReach Bot, a helpful AI counselor for EduReach College, Hyderabad. " +
        "ALWAYS use the retrieve tool to search the knowledge base before answering. " +
        "Be concise, friendly, and professional. " +
        "If the information is not found, say: " +
        "'I don't have that information right now. Click Talk to Us to speak with a counselor.'",
    });

    const result = await agent.invoke({
      messages: [{ role: "user", content: question }],
    });

    const messages = result.messages;
    const lastMessage = messages[messages.length - 1];

    if (!lastMessage) {
      return "I couldn't generate a response. Please try again.";
    }

    return typeof lastMessage.content === "string"
      ? lastMessage.content
      : JSON.stringify(lastMessage.content);
  } catch (error) {
    console.error(" RAG Agent Error:", error);
    return "I'm having trouble right now. Please try again or click 'Talk to Us'.";
  }
};