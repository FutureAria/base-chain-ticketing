import { RouterProvider } from "react-router";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { router } from "./routes";
import { AppSettingsProvider } from "./context/AppSettingsContext";
import { AuthProvider } from "./context/AuthContext";

export default function App() {
  return (
    <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ""}>
      <AppSettingsProvider>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AppSettingsProvider>
    </GoogleOAuthProvider>
  );
}
