import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Trophy, Eye, EyeOff } from "lucide-react";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";

export function Register() {
  const navigate = useNavigate();
  const { register } = useAuth();

  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (password.length < 6) {
      setError("비밀번호는 6자 이상이어야 합니다.");
      return;
    }

    setIsLoading(true);
    try {
      await register(email, password, nickname);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "회원가입 실패");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-8"
      style={{ background: "linear-gradient(180deg, #eef2f4 0%, #e4eaed 100%)" }}
    >
      <div className="w-full max-w-[420px]">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-3 mb-8">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #4c6787, #6d89a3, #74a38a)" }}
          >
            <Trophy className="w-5 h-5 text-white" />
          </div>
          <span
            className="text-[1.1rem] font-bold tracking-[0.08em]"
            style={{ background: "linear-gradient(90deg, #45617f, #6b8878)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
          >
            BASE CHAIN
          </span>
        </Link>

        {/* Card */}
        <div
          className="rounded-[24px] border px-8 py-8"
          style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 32px rgba(17,40,73,0.07)" }}
        >
          <h1 className="text-[1.4rem] font-bold mb-1" style={{ color: "#1f3248" }}>회원가입</h1>
          <p className="text-[0.85rem] mb-6" style={{ color: "#6d7d90" }}>
            이미 계정이 있으신가요?{" "}
            <Link to="/login" className="font-semibold" style={{ color: "#526183" }}>
              로그인
            </Link>
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[0.82rem] font-semibold mb-1.5" style={{ color: "#44556c" }}>
                닉네임
              </label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="사용할 닉네임"
                required
                maxLength={50}
                className="w-full h-11 rounded-[12px] border px-4 text-sm outline-none transition-all"
                style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
              />
            </div>

            <div>
              <label className="block text-[0.82rem] font-semibold mb-1.5" style={{ color: "#44556c" }}>
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="example@email.com"
                required
                className="w-full h-11 rounded-[12px] border px-4 text-sm outline-none transition-all"
                style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
              />
            </div>

            <div>
              <label className="block text-[0.82rem] font-semibold mb-1.5" style={{ color: "#44556c" }}>
                비밀번호 <span className="font-normal" style={{ color: "#8a9aac" }}>(6자 이상)</span>
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호 입력"
                  required
                  className="w-full h-11 rounded-[12px] border px-4 pr-11 text-sm outline-none transition-all"
                  style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "#8a9aac" }}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[0.82rem] font-semibold mb-1.5" style={{ color: "#44556c" }}>
                비밀번호 확인
              </label>
              <input
                type={showPassword ? "text" : "password"}
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호 재입력"
                required
                className="w-full h-11 rounded-[12px] border px-4 text-sm outline-none transition-all"
                style={{ background: "#f0f4f7", borderColor: "#d0d8e2", color: "#1f3248" }}
              />
            </div>

            {error && (
              <div
                className="rounded-[12px] border px-4 py-3 text-[0.83rem]"
                style={{ background: "#f8efe9", borderColor: "#ead5c7", color: "#8f5d3b" }}
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 rounded-[14px] font-semibold text-white mt-2"
              style={{ background: "#526183" }}
            >
              {isLoading ? "가입 중..." : "회원가입"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
