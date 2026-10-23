import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { AuthProvider } from "@/lib/auth";
import { startAutoSync } from "@/lib/offline";
import { ToastProvider } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && [400, 401, 403, 404].includes(e.status)) && n < 2,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

function AutoSync() {
  useEffect(() => startAutoSync(), []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AutoSync />
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
