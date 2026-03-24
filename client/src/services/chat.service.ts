import axios from "axios";
import API from "./api";

interface ChatResponse {
  message: string;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const sendMessage = async (message: string): Promise<ChatResponse> => {
  if (!message?.trim()) throw new Error("Message cannot be empty.");

  try {
    const res = await API.post<ApiResponse<ChatResponse>>("/chat/message", {
      message: message.trim(),
    });
    return res.data.data;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === 401) throw new Error("Unauthorized. Please log in again.");
      if (status === 429) throw new Error("Too many requests. Please slow down.");
      if (status === 500) throw new Error("Server error. Please try again later.");
    }
    throw new Error("Unable to reach the server.");
  }
};