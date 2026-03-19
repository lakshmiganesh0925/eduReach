import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { AuthProvider } from "./context/AuthContext.tsx";
import { StrictMode } from 'react'
import './index.css'
import App from './App.tsx'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
    <AuthProvider>
      <App/>
      <Toaster position="top-right"/>
    </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
