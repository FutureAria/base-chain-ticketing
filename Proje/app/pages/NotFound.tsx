import { useEffect } from "react";
import { useNavigate } from "react-router";

export function NotFound() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/", { replace: true });
  }, [navigate]);

  return null;
}
