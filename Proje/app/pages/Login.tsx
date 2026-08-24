import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Trophy, Eye, EyeOff, ChevronLeft } from "lucide-react";
import { useGoogleLogin } from "@react-oauth/google";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";

type View = "login" | "findId" | "findPassword";
const API_ORIGIN = (
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (typeof window !== "undefined" ? window.location.origin : "")
).replace(/\/$/, "");
const SAFE_API_ORIGIN =
  typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1" &&
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(API_ORIGIN)
    ? window.location.origin
    : API_ORIGIN;
const API_BASE = `${SAFE_API_ORIGIN}/api`;

async function readLoginJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();

  if (!contentType.includes("application/json")) {
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("서버 응답을 읽는 중 문제가 발생했습니다.");
  }
}

function getErrorMessage(data: unknown, fallbackMessage: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error?: unknown }).error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallbackMessage;
}

export function Login() {
  const navigate = useNavigate();
  const { login, googleLogin } = useAuth();

  const [view, setView] = useState<View>("login");

  // 로그인
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);

  // 아이디 찾기
  const [findIdNickname, setFindIdNickname] = useState("");
  const [findIdResult, setFindIdResult] = useState<string | null>(null);
  const [findIdError, setFindIdError] = useState<string | null>(null);
  const [isFindIdLoading, setIsFindIdLoading] = useState(false);

  // 비밀번호 찾기
  const [findPwEmail, setFindPwEmail] = useState("");
  const [findPwResult, setFindPwResult] = useState<string | null>(null);
  const [findPwError, setFindPwError] = useState<string | null>(null);
  const [isFindPwLoading, setIsFindPwLoading] = useState(false);

  function goToView(v: View) {
    setView(v);
    setFindIdNickname(""); setFindIdResult(null); setFindIdError(null);
    setFindPwEmail(""); setFindPwResult(null); setFindPwError(null);
    setError(null);
  }

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인 실패");
    } finally {
      setIsLoading(false);
    }
  }

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setError(null);
      setIsGoogleLoading(true);
      try {
        await googleLogin(tokenResponse.access_token);
        navigate("/", { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : "구글 로그인 실패");
      } finally {
        setIsGoogleLoading(false);
      }
    },
    onError: () => setError("구글 로그인이 취소되었거나 실패했습니다."),
  });

  async function handleFindId() {
    if (!findIdNickname.trim()) { setFindIdError("닉네임을 입력해주세요."); return; }
    setIsFindIdLoading(true); setFindIdError(null); setFindIdResult(null);
    try {
      const res = await fetch(`${API_BASE}/auth/find-id`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: findIdNickname }),
      });
      const data = await readLoginJson<{ maskedEmail?: string; error?: string }>(res, "아이디 찾기 요청에 실패했습니다.");
      if (!res.ok) { setFindIdError(getErrorMessage(data, "아이디 찾기 요청에 실패했습니다.")); return; }
      setFindIdResult(data.maskedEmail);
    } catch (err) {
      setFindIdError(err instanceof Error ? err.message : "서버 오류가 발생했습니다.");
    } finally {
      setIsFindIdLoading(false);
    }
  }

  async function handleFindPassword() {
    if (!findPwEmail.trim()) { setFindPwError("이메일을 입력해주세요."); return; }
    setIsFindPwLoading(true); setFindPwError(null); setFindPwResult(null);
    try {
      const res = await fetch(`${API_BASE}/auth/find-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: findPwEmail }),
      });
      const data = await readLoginJson<{ message?: string; error?: string }>(res, "비밀번호 찾기 요청에 실패했습니다.");
      if (!res.ok) { setFindPwError(getErrorMessage(data, "비밀번호 찾기 요청에 실패했습니다.")); return; }
      // 서버는 계정 존재 여부와 무관하게 같은 안내를 준다 (가입 여부가 새어나가지 않도록).
      setFindPwResult(data.message ?? "비밀번호 재설정 안내를 처리했습니다.");
    } catch (err) {
      setFindPwError(err instanceof Error ? err.message : "서버 오류가 발생했습니다.");
    } finally {
      setIsFindPwLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: "linear-gradient(180deg, #eef2f4 0%, #e4eaed 100%)" }}
    >
      <div className="w-full max-w-[500px]">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-3 mb-8">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #4c6787, #6d89a3, #74a38a)" }}
          >
            <Trophy className="w-6 h-6 text-white" />
          </div>
          <span
            className="text-[1.2rem] font-bold tracking-[0.08em]"
            style={{ background: "linear-gradient(90deg, #45617f, #6b8878)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            BASE CHAIN
          </span>
        </Link>

        {/* Card */}
        <div
          className="rounded-[28px] border px-10 py-10"
          style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 32px rgba(17,40,73,0.07)" }}
        >

          {/* ─── 로그인 뷰 ─── */}
          {view === "login" && (
            <>
              <h1 className="text-[1.7rem] font-bold mb-1.5" style={{ color: "#1f3248" }}>로그인</h1>
              <p className="text-[0.92rem] mb-7" style={{ color: "#6d7d90" }}>
                계정이 없으신가요?{" "}
                <Link to="/register" className="font-semibold" style={{ color: "#526183" }}>
                  회원가입
                </Link>
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-[0.88rem] font-semibold mb-2" style={{ color: "#44556c" }}>이메일</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@email.com"
                    required
                    className="w-full h-12 rounded-[14px] border px-4 text-[0.95rem] outline-none transition-all"
                    style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
                  />
                </div>

                <div>
                  <label className="block text-[0.88rem] font-semibold mb-2" style={{ color: "#44556c" }}>비밀번호</label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="비밀번호 입력"
                      required
                      className="w-full h-12 rounded-[14px] border px-4 pr-12 text-[0.95rem] outline-none transition-all"
                      style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2"
                      style={{ color: "#8a9aac" }}
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="rounded-[12px] border px-4 py-3 text-[0.88rem]"
                    style={{ background: "#f8efe9", borderColor: "#ead5c7", color: "#8f5d3b" }}>
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 rounded-[14px] font-semibold text-[1rem] text-white mt-1"
                  style={{ background: "#526183" }}
                >
                  {isLoading ? "로그인 중..." : "로그인"}
                </Button>
              </form>

              {/* 구글 로그인 */}
              <div className="mt-5">
                <div className="flex items-center gap-3 mb-5">
                  <div className="flex-1 h-px" style={{ background: "#d6dfe8" }} />
                  <span className="text-[0.82rem]" style={{ color: "#8a9aac" }}>또는</span>
                  <div className="flex-1 h-px" style={{ background: "#d6dfe8" }} />
                </div>
                <button
                  type="button"
                  onClick={() => handleGoogleLogin()}
                  disabled={isGoogleLoading}
                  className="w-full h-12 rounded-[14px] border flex items-center justify-center gap-3 text-[0.95rem] font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ background: "#f8fafc", borderColor: "#d0d8e2", color: "#44556c" }}
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  {isGoogleLoading ? "로그인 중..." : "Google로 로그인"}
                </button>
              </div>

              {/* 아이디/비밀번호 찾기 링크 */}
              <div className="mt-5 flex items-center justify-center gap-4 text-[0.88rem]" style={{ color: "#8a9aac" }}>
                <button
                  type="button"
                  onClick={() => goToView("findId")}
                  className="hover:underline transition-colors hover:text-[#526183]"
                >
                  아이디 찾기
                </button>
                <span className="text-[#d0d8e2]">|</span>
                <button
                  type="button"
                  onClick={() => goToView("findPassword")}
                  className="hover:underline transition-colors hover:text-[#526183]"
                >
                  비밀번호 찾기
                </button>
              </div>
            </>
          )}

          {/* ─── 아이디 찾기 뷰 ─── */}
          {view === "findId" && (
            <>
              <button
                onClick={() => goToView("login")}
                className="flex items-center gap-1.5 mb-6 text-[0.88rem] font-medium transition-colors hover:opacity-70"
                style={{ color: "#526183" }}
              >
                <ChevronLeft className="w-4 h-4" />
                로그인으로 돌아가기
              </button>

              <h1 className="text-[1.7rem] font-bold mb-1.5" style={{ color: "#1f3248" }}>아이디 찾기</h1>
              <p className="text-[0.92rem] mb-7" style={{ color: "#6d7d90" }}>
                가입 시 사용한 닉네임을 입력하면 등록된 이메일을 알려드립니다.
              </p>

              <div className="space-y-5">
                <div>
                  <label className="block text-[0.88rem] font-semibold mb-2" style={{ color: "#44556c" }}>닉네임</label>
                  <input
                    type="text"
                    value={findIdNickname}
                    onChange={(e) => setFindIdNickname(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleFindId()}
                    placeholder="가입 시 사용한 닉네임"
                    className="w-full h-12 rounded-[14px] border px-4 text-[0.95rem] outline-none"
                    style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
                  />
                </div>

                {findIdError && (
                  <div className="rounded-[12px] border px-4 py-3 text-[0.88rem]"
                    style={{ background: "#f8efe9", borderColor: "#ead5c7", color: "#8f5d3b" }}>
                    {findIdError}
                  </div>
                )}

                {findIdResult && (
                  <div className="rounded-[14px] border px-5 py-4 space-y-1"
                    style={{ background: "#edf7f1", borderColor: "#c7dfd0" }}>
                    <p className="text-[0.82rem] font-semibold" style={{ color: "#28764d" }}>등록된 이메일</p>
                    <p className="text-[1.1rem] font-bold tracking-wide" style={{ color: "#1f4a30" }}>{findIdResult}</p>
                  </div>
                )}

                <Button
                  type="button"
                  onClick={handleFindId}
                  disabled={isFindIdLoading}
                  className="w-full h-12 rounded-[14px] font-semibold text-[1rem] text-white"
                  style={{ background: "#526183" }}
                >
                  {isFindIdLoading ? "조회 중..." : "아이디 찾기"}
                </Button>
              </div>
            </>
          )}

          {/* ─── 비밀번호 찾기 뷰 ─── */}
          {view === "findPassword" && (
            <>
              <button
                onClick={() => goToView("login")}
                className="flex items-center gap-1.5 mb-6 text-[0.88rem] font-medium transition-colors hover:opacity-70"
                style={{ color: "#526183" }}
              >
                <ChevronLeft className="w-4 h-4" />
                로그인으로 돌아가기
              </button>

              <h1 className="text-[1.7rem] font-bold mb-1.5" style={{ color: "#1f3248" }}>비밀번호 찾기</h1>
              <p className="text-[0.92rem] mb-7" style={{ color: "#6d7d90" }}>
                가입 시 사용한 이메일을 입력하면 임시 비밀번호를 발급해드립니다.
              </p>

              <div className="space-y-5">
                <div>
                  <label className="block text-[0.88rem] font-semibold mb-2" style={{ color: "#44556c" }}>이메일</label>
                  <input
                    type="email"
                    value={findPwEmail}
                    onChange={(e) => setFindPwEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleFindPassword()}
                    placeholder="가입 시 사용한 이메일"
                    className="w-full h-12 rounded-[14px] border px-4 text-[0.95rem] outline-none"
                    style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
                  />
                </div>

                {findPwError && (
                  <div className="rounded-[12px] border px-4 py-3 text-[0.88rem]"
                    style={{ background: "#f8efe9", borderColor: "#ead5c7", color: "#8f5d3b" }}>
                    {findPwError}
                  </div>
                )}

                {findPwResult && (
                  <div className="rounded-[14px] border px-5 py-4 space-y-1"
                    style={{ background: "#edf7f1", borderColor: "#c7dfd0" }}>
                    <p className="text-[0.82rem] font-semibold" style={{ color: "#28764d" }}>재설정 안내</p>
                    <p className="text-[0.86rem] leading-relaxed" style={{ color: "#1f4a30" }}>{findPwResult}</p>
                    <p className="text-[0.78rem] mt-1" style={{ color: "#5a8c6e" }}>
                      링크는 30분 동안만 유효합니다. 메일이 오지 않으면 입력한 주소를 다시 확인해주세요.
                    </p>
                  </div>
                )}

                <Button
                  type="button"
                  onClick={handleFindPassword}
                  disabled={isFindPwLoading}
                  className="w-full h-12 rounded-[14px] font-semibold text-[1rem] text-white"
                  style={{ background: "#526183" }}
                >
                  {isFindPwLoading ? "발급 중..." : "임시 비밀번호 발급"}
                </Button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
