import mongoose ,{Schema} from 'mongoose';
import type { Document } from 'mongoose';

export interface IKnowledgeDoc extends Document {
    text:string;
    embedding:number[];
    metadata:Record<string,any>;
}

const KnowledgeDocSchema: Schema<IKnowledgeDoc> = new Schema({
   text:{type:String,required:true},
   embedding:{type:[Number],default:[]},
   metadata:{type:Schema.Types.Mixed,default:{}}
})

export const KnowledgeDoc = mongoose.model<IKnowledgeDoc>('KnowledgeDoc',KnowledgeDocSchema,"knowledge_docs")
