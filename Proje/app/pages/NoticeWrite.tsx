import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { PenLine, ImagePlus, Pin, ChevronLeft, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { authHeaders } from "../lib/authHeaders";

type NoticeType = "공지" | "이벤트" | "업데이트";

const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");

export function NoticeWrite() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = Boolean(id);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<NoticeType>("공지");
  const [isPinned, setIsPinned] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 수정 모드일 때 기존 데이터 로드
  useEffect(() => {
    if (!isEdit || !id) return;
    fetch(`${API_BASE}/api/notices`)
      .then((res) => res.json())
      .then((data: any[]) => {
        const notice = data.find((n) => String(n.id) === id);
        if (!notice) return;
        setTitle(notice.title);
        setContent(notice.content);
        setType(notice.type);
        setIsPinned(!!notice.is_pinned);
        setExistingImageUrl(notice.image_url || null);
      })
      .catch((err) => console.error("공지 로드 실패:", err));
  }, [id, isEdit]);

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) {
      alert("제목과 내용을 입력해주세요.");
      return;
    }
    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("title", title);
      formData.append("content", content);
      formData.append("type", type);
      formData.append("is_pinned", isPinned ? "1" : "0");
      if (imageFile) {
        formData.append("image", imageFile);
      } else if (existingImageUrl) {
        formData.append("image_url", existingImageUrl);
      }

      const url = isEdit
        ? `${API_BASE}/api/notices/${id}`
        : `${API_BASE}/api/notices`;
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, { method, body: formData, headers: authHeaders() });
      if (res.ok) {
        alert(isEdit ? "수정되었습니다." : "공지가 등록되었습니다.");
        navigate("/notice");
      } else {
        alert("저장에 실패했습니다.");
      }
    } catch (err) {
      console.error(err);
      alert("오류가 발생했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const typeOptions: { value: NoticeType; label: string; bg: string; text: string; border: string }[] = [
    { value: "공지",    label: "공지",    bg: "#fff7e8", text: "#9a6b1b", border: "#ead4a2" },
    { value: "이벤트",  label: "이벤트",  bg: "#eef4ff", text: "#245ca6", border: "#c9d8ef" },
    { value: "업데이트", label: "업데이트", bg: "#edf7f1", text: "#28764d", border: "#c7dfd0" },
  ];

  return (
    <div className="page-shell space-y-6">
      {/* Header */}
      <div className="page-header flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/notice")}
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-[#526183]" />
          </button>
          <div className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #506987, #6f89a3)", boxShadow: "0 8px 18px rgba(48,69,94,0.12)" }}>
            <PenLine className="w-6 h-6 text-white" />
          </div>
          <div>
            <p className="page-eyebrow mb-1 font-bold" style={{ color: "#1456a0" }}>개발자 모드</p>
            <h1 className="page-title text-xl font-bold" style={{ color: "#16283f" }}>
              {isEdit ? "공지 수정" : "공지 작성"}
            </h1>
          </div>
        </div>
      </div>

      <div className="rounded-[24px] border px-6 py-6 space-y-6"
        style={{ background: "#f8fafc", borderColor: "#d6dfe8", boxShadow: "0 10px 24px rgba(17,40,73,0.05)" }}>

        {/* 타입 선택 */}
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: "#526183" }}>유형</label>
          <div className="flex gap-2">
            {typeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setType(opt.value)}
                className="px-4 py-2 rounded-xl text-sm font-semibold border transition-all"
                style={{
                  background: type === opt.value ? opt.bg : "#f0f4f8",
                  color: type === opt.value ? opt.text : "#7b8ca4",
                  borderColor: type === opt.value ? opt.border : "#d7e0ea",
                  fontWeight: type === opt.value ? 700 : 500,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 고정 여부 */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPinned(!isPinned)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border transition-all"
            style={{
              background: isPinned ? "#fff7e8" : "#f0f4f8",
              borderColor: isPinned ? "#ead4a2" : "#d7e0ea",
              color: isPinned ? "#9a6b1b" : "#7b8ca4",
            }}
          >
            <Pin className={`w-4 h-4 ${isPinned ? "fill-[#9a6b1b]" : ""}`} />
            <span className="text-sm font-semibold">{isPinned ? "고정됨" : "고정 안 함"}</span>
          </button>
        </div>

        {/* 제목 */}
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: "#526183" }}>제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="공지 제목을 입력하세요"
            className="w-full rounded-[16px] border px-4 py-3 text-[0.95rem] outline-none focus:ring-2 focus:ring-[#506987]/30"
            style={{ background: "#fff", borderColor: "#d7e0ea", color: "#1c2f4a" }}
          />
        </div>

        {/* 내용 */}
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: "#526183" }}>내용</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="공지 내용을 입력하세요"
            rows={10}
            className="w-full rounded-[16px] border px-4 py-3 text-[0.95rem] outline-none focus:ring-2 focus:ring-[#506987]/30 resize-none"
            style={{ background: "#fff", borderColor: "#d7e0ea", color: "#1c2f4a" }}
          />
        </div>

        {/* 이미지 업로드 */}
        <div>
          <label className="block text-sm font-semibold mb-2" style={{ color: "#526183" }}>이미지 (선택)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setImageFile(file);
              if (file) setExistingImageUrl(null);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-3 rounded-[16px] border transition-all hover:brightness-95"
            style={{ background: "#f0f4f8", borderColor: "#d7e0ea", color: "#526183" }}
          >
            <ImagePlus className="w-5 h-5" />
            <span className="text-sm font-medium">
              {imageFile ? imageFile.name : existingImageUrl ? "기존 이미지 유지" : "이미지 선택"}
            </span>
          </button>
          {(imageFile || existingImageUrl) && (
            <div className="mt-3 rounded-[16px] overflow-hidden border border-[#d7e0ea] max-w-sm">
              <img
                src={imageFile ? URL.createObjectURL(imageFile) : `${API_BASE}${existingImageUrl}`}
                alt="미리보기"
                className="w-full h-auto object-contain"
              />
            </div>
          )}
        </div>
      </div>

      {/* 버튼 */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1 h-12 rounded-[14px] border-[#d2dbe5] text-[#526183]"
          onClick={() => navigate("/notice")}
          disabled={isSubmitting}
        >
          취소
        </Button>
        <Button
          className="flex-1 h-12 rounded-[14px] font-semibold text-white bg-[#506987] hover:bg-[#3f546d]"
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 저장 중...</>
          ) : (
            isEdit ? "수정 완료" : "등록하기"
          )}
        </Button>
      </div>
    </div>
  );
}
