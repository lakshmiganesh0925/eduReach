import app from "./app.ts";
import connectDB from "./config/database.config.ts";

const PORT =process.env.PORT || 5000;

const start = async() :Promise<void>=>{
    try{
      await connectDB();

      app.listen(PORT,()=>{
        console.log("EduReach server is running!");
        console.log("URL:http://localhost:"+PORT);
        console.log("NODE : "+process.version);
        console.log("Press Crtl+C to stop");
      })
    }catch(error){
        console.error('Failed to start server:',error);
        process.exit(1);
    }
}

start();