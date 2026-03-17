import type { Request,Response,NextFunction } from "express";

const errorHandler =(err:Error,_req:Request,res:Response,_next:NextFunction):void=>{
   console.error("Error :", err.message);
   res.status(500).json({
    suceess:false,
    message:err.message||"Interval server error.",
   });
};

export default errorHandler;