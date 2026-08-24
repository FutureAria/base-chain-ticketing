import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { ShieldAlert } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui/button";

/**
 * 관리자 전용 화면을 감싸는 가드.
 *
 * 권한 판단의 기준은 어디까지나 서버다(API가 401/403을 돌려준다).
 * 이 컴포넌트는 그 위에 얹는 안내로, 권한 없는 사용자가 검표 화면이나 공지 작성 폼을
 * 끝까지 채운 뒤에야 403을 받는 상황을 막기 위한 것이다.
 */
export function AdminOnly({ children, title = "관리자 전용 화면" }: {
  children: ReactNode;
  title?: string;
}) {
  const { user, isLoggedIn, isLoading } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-[0.9rem]" style={{ color: "#6b7a8c" }}>확인 중…</p>
      </div>
    );
  }

  if (isLoggedIn && user?.role === "admin") {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div
        className="w-full max-w-md rounded-[18px] border px-7 py-9 text-center"
        style={{ background: "#ffffff", borderColor: "#e3e9ef" }}
      >
        <ShieldAlert className="mx-auto mb-4 h-10 w-10" style={{ color: "#c2803f" }} />
        <h1 className="mb-2 text-[1.15rem] font-bold" style={{ color: "#1f2d3d" }}>{title}</h1>
        <p className="mb-6 text-[0.88rem] leading-relaxed" style={{ color: "#6b7a8c" }}>
          {isLoggedIn
            ? "이 화면은 운영자 계정에서만 사용할 수 있습니다."
            : "운영자 계정으로 로그인한 뒤 이용해주세요."}
        </p>
        <div className="flex justify-center gap-2">
          {!isLoggedIn && (
            <Button type="button" onClick={() => navigate("/login")}>로그인</Button>
          )}
          <Button type="button" variant="outline" onClick={() => navigate("/")}>홈으로</Button>
        </div>
      </div>
    </div>
  );
}
