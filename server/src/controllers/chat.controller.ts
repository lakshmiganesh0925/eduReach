import type {Request, Response,NextFunction} from "express";
import { getRAGResponse } from "../services/rag.service.ts";

export const sendMessage = async(req:Request,res:Response,next:NextFunction):Promise<void>=>
  {
    try{
    const {message}=req.body;
    if(!message || typeof message !== "string" || !message.trim()){
        res.status(400).json({error:"Invalid message format"});
        return;
    }
    const response = await getRAGResponse(message.trim());
    res.json({success:true,data:{message:response}});
}catch(error){ next(error);}
}