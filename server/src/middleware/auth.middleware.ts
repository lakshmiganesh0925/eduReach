import type {Request, Response, NextFunction} from "express"
import {verifyToken} from "../utils/jwt.utils.ts";
import type {JWTPayload} from "../utils/jwt.utils.ts";

declare global{
    namespace Express{
        interface Request{
            userId?:JWTPayload;
        }
    }
}

const authMiddleware = (req:Request,res:Response,next:NextFunction):void=>{
  try{
    const authHeader =req.headers.authorization;

    if(!authHeader || ! authHeader.startsWith('Bearer')){
       res.json(401).json({success:false, message:"Access denied. No token provided"});
       return ;
    }
    const token= authHeader.split(" ")[1];
    if(!token){
        res.status(401).json({success:false,message:"Access Denied .Token is empty."});
    }
    const decoded  =verifyToken(token);
    req.user=decoded;
    next();
  }catch(error){
     if(error instanceof Error){
        if(error.name ==="TokenExpiredError"){
          res.status(401).json({success:false,message:"Token has expired. Please log in again"});
          return;        
        }
        if(error.name==="JsonWebTokenError"){
            res.status(401).json({success:false, message:"Invalid token. Please log in again"});
            return;      
        }
     }
      res.status(500).json({success:false, message:"Authentication failed."});
  }
}

export default authMiddleware;



