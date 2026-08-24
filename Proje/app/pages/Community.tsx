import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { CiCirclePlus } from "react-icons/ci";
import {
  Bookmark,
  BookmarkCheck,
  Copy,
  Crown,
  Eye,
  Flame,
  Flag,
  Gem,
  Heart,
  MessageSquareText,
  MessagesSquare,
  Pencil,
  Pin,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { useAuth } from "../context/AuthContext";

type CommunityCategory = "all" | "ticket" | "fragment" | "baseball" | "strategy";
type FeedMode = "discover" | "bookmarks" | "my_posts" | "my_comments";
type FeedSort = "latest" | "popular" | "replies";
type CommentSort = "best" | "latest";
type QuickFilter = "all" | "hot";
type UserRole = "user" | "moderator" | "admin";
type NotificationType =
  | "reply"
  | "mention"
  | "like"
  | "bookmark"
  | "system"
  | "report"
  | "tag";
type ReportTargetType = "post" | "comment" | "user";

type CommunityUser = {
  id: string;
  nickname: string;
  handle: string;
  avatar: string;
  bio: string;
  role: UserRole;
  joinedAt: string;
  level: number;
  trustScore: number;
  followers: number;
  followingUserIds: string[];
  followedTags: string[];
  blockedUserIds: string[];
  mutedTags: string[];
  verifiedWallet: boolean;
  verifiedTicket: boolean;
  verifiedNft: boolean;
  official?: boolean;
  writeRestricted?: boolean;
  commentRestricted?: boolean;
  newbie?: boolean;
};

type CommunityPost = {
  id: number;
  authorId: string;
  title: string;
  excerpt: string;
  content: string;
  category: Exclude<CommunityCategory, "all">;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  likes: string[];
  bookmarks: string[];
  viewCount: number;
  pinned?: boolean;
  hot?: boolean;
  announcement?: boolean;
  verifiedReview?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  reportCount: number;
};

type CommunityComment = {
  id: number;
  postId: number;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  likes: string[];
  parentId: number | null;
  hidden?: boolean;
  deleted?: boolean;
};

type CommunityNotification = {
  id: number;
  userId: string;
  type: NotificationType;
  text: string;
  createdAt: string;
  read: boolean;
  postId?: number;
  commentId?: number;
};

type CommunityReport = {
  id: number;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  detail: string;
  createdAt: string;
  status: "pending" | "reviewed";
};

type CommunityState = {
  users: CommunityUser[];
  posts: CommunityPost[];
  comments: CommunityComment[];
  notifications: CommunityNotification[];
  reports: CommunityReport[];
  currentUserId: string | null;
};

type EditorDraft = {
  title: string;
  category: Exclude<CommunityCategory, "all">;
  content: string;
  externalLink?: string;
};

type FlashTone = "info" | "success" | "warning";

const COMMUNITY_DRAFT_KEY = "baseball-community-draft-v2";
const POSTS_PER_PAGE = 10;

const categoryLabels: Record<CommunityCategory, string> = {
  all: "전체",
  ticket: "티켓 거래",
  fragment: "파편 거래",
  baseball: "야구 토크",
  strategy: "시세 전략",
};

const categoryAccent: Record<Exclude<CommunityCategory, "all">, string> = {
  ticket: "#2563a8",
  fragment: "#5a6aa8",
  baseball: "#3b4890",
  strategy: "#9a6d2f",
};


const feedSortLabels: Record<FeedSort, string> = {
  latest: "최신순",
  popular: "인기순",
  replies: "댓글 많은 순",
};

const commentSortLabels: Record<CommentSort, string> = {
  best: "공감순",
  latest: "최신순",
};

const reportReasons = [
  "도배/광고",
  "허위 정보",
  "시세 조작 유도",
  "욕설/비방",
  "개인정보 노출",
  "외부 거래 유도",
];

const emptyDraft: EditorDraft = {
  title: "",
  category: "baseball",
  content: "",
  externalLink: "",
};



const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '');
const API = `${API_BASE}/api`;
// 서버가 허용하는 한 번 조회 최대치(GET /api/posts 의 limit 상한)와 맞춘다.
const POSTS_FETCH_LIMIT = 100;

function emptyState(): CommunityState {
  return {
    users: [],
    posts: [],
    comments: [],
    notifications: [],
    reports: [],
    currentUserId: 'viewer',
  };
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function loadDraft(): EditorDraft {
  if (typeof window === "undefined") return emptyDraft;
  const stored = safeParse<Partial<EditorDraft>>(localStorage.getItem(COMMUNITY_DRAFT_KEY));
  return stored ? { ...emptyDraft, ...stored } : emptyDraft;
}


function summarize(content: string) {
  return `${content.replace(/\s+/g, " ").trim().slice(0, 72)}${content.length > 72 ? "..." : ""}`;
}

function badgeList(user: CommunityUser) {
  const badges = [];

  if (user.official) badges.push({ label: "공식", color: "#c9982d", icon: Crown });
  if (user.role === "moderator") badges.push({ label: "모더레이터", color: "#3b4890", icon: ShieldCheck });
  if (user.verifiedTicket) badges.push({ label: "티켓 인증", color: "#2f855a", icon: Ticket });
  if (user.verifiedNft) badges.push({ label: "NFT 보유", color: "#7a86a8", icon: Gem });
  if (user.verifiedWallet) badges.push({ label: "지갑 인증", color: "#64748b", icon: Wallet });
  if (user.newbie) badges.push({ label: "신규", color: "#3b82f6", icon: Sparkles });

  return badges;
}

export function Community() {
  const navigate = useNavigate();
  const { user: authUser, isLoggedIn: authLoggedIn } = useAuth();
  const isLoggedIn = authLoggedIn;
  const detailSectionRef = useRef<HTMLElement | null>(null);
  const [community, setCommunity] = useState<CommunityState>(emptyState);
  const [draft, setDraft] = useState<EditorDraft>(() => loadDraft());
  const [category, setCategory] = useState<CommunityCategory>("all");
  const [feedMode] = useState<FeedMode>("discover");
  const [feedSort, setFeedSort] = useState<FeedSort>("latest");
  const [commentSort, setCommentSort] = useState<CommentSort>("best");
  const [quickFilter] = useState<QuickFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [highlightedCommentId, setHighlightedCommentId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editingPostId, setEditingPostId] = useState<number | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ type: ReportTargetType; id: string } | null>(null);
  const [reportReason, setReportReason] = useState(reportReasons[0]);
  const [reportDetail, setReportDetail] = useState("");
  const [flashMessage, setFlashMessage] = useState<{ tone: FlashTone; text: string } | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [replyTargetId, setReplyTargetId] = useState<number | null>(null);
  const [replyInput, setReplyInput] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentInput, setEditingCommentInput] = useState("");
  const [postPage, setPostPage] = useState(1);

  const deferredQuery = useDeferredValue(query);
  const authHeaders = (json = true): HeadersInit => {
    const token = localStorage.getItem("auth_token") ?? "";
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  };

  // 마운트 시 서버에서 데이터 로드
  useEffect(() => {
    Promise.all([
      fetch(`${API}/users`).then((r) => r.json()),
      // 이 화면은 받아온 글 전체를 클라이언트에서 필터·정렬·페이징한다.
      // 서버 기본값(20건)만 받으면 목록이 잘리므로 한도를 명시한다.
      // 글이 이보다 많아지면 서버 페이지네이션으로 옮겨야 한다.
      fetch(`${API}/posts?limit=${POSTS_FETCH_LIMIT}`).then((r) => r.json()),
      fetch(`${API}/comments`).then((r) => r.json()),
    ])
      .then(([usersRaw, postsRaw, commentsRaw]) => {
        const users: CommunityUser[] = usersRaw.map((u: { user_id: string; nickname: string }) => ({
          id: u.user_id,
          nickname: u.nickname,
          handle: u.user_id,
          avatar: u.nickname.slice(0, 1).toUpperCase(),
          bio: "",
          role: "user" as const,
          joinedAt: "",
          level: 1,
          trustScore: 100,
          followers: 0,
          followingUserIds: [],
          followedTags: [],
          blockedUserIds: [],
          mutedTags: [],
          verifiedWallet: false,
          verifiedTicket: false,
          verifiedNft: false,
        }));
        if (authUser && !users.some((user) => user.id === authUser.user_id)) {
          users.push({
            id: authUser.user_id,
            nickname: authUser.nickname,
            handle: authUser.user_id,
            avatar: authUser.nickname.slice(0, 1).toUpperCase(),
            bio: "",
            role: "user",
            joinedAt: "",
            level: 1,
            trustScore: 100,
            followers: 0,
            followingUserIds: [],
            followedTags: [],
            blockedUserIds: [],
            mutedTags: [],
            verifiedWallet: false,
            verifiedTicket: false,
            verifiedNft: false,
          });
        }

        const posts: CommunityPost[] = postsRaw.map((p: {
          post_id: number; user_id: string; title: string; excerpt: string;
          content: string; category: string; created_at: string; updated_at: string;
          view_count: number; like_count: number;
        }) => ({
          id: p.post_id,
          authorId: p.user_id,
          title: p.title,
          excerpt: p.excerpt,
          content: p.content,
          category: p.category as Exclude<CommunityCategory, "all">,
          tags: [categoryLabels[p.category as CommunityCategory]],
          createdAt: new Date(p.created_at).toLocaleString("ko-KR").replace(/\. /g, ".").replace(",", ""),
          updatedAt: new Date(p.updated_at).toLocaleString("ko-KR").replace(/\. /g, ".").replace(",", ""),
          likes: Array(p.like_count).fill(""),
          bookmarks: [],
          viewCount: p.view_count,
          reportCount: 0,
        }));

        const comments: CommunityComment[] = commentsRaw.map((c: {
          comment_id: number; post_id: number; user_id: string;
          content: string; created_at: string; updated_at: string | null; parent_id: number | null;
        }) => ({
          id: c.comment_id,
          postId: c.post_id,
          authorId: c.user_id,
          content: c.content,
          createdAt: new Date(c.created_at).toLocaleString("ko-KR").replace(/\. /g, ".").replace(",", ""),
          likes: [],
          parentId: c.parent_id,
        }));

        setCommunity((prev) => ({ ...prev, users, posts, comments, currentUserId: authUser?.user_id ?? null }));
      })
      .catch(() => {
        console.error("서버에 연결할 수 없습니다. 서버를 먼저 실행해주세요.");
      });
  }, [authUser]);

  useEffect(() => {
    localStorage.setItem(COMMUNITY_DRAFT_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    if (!flashMessage) return;
    const timer = window.setTimeout(() => setFlashMessage(null), 2400);
    return () => window.clearTimeout(timer);
  }, [flashMessage]);

  const usersById = useMemo(
    () =>
      Object.fromEntries(community.users.map((user) => [user.id, user] as const)),
    [community.users],
  );

  const currentUser = community.currentUserId ? usersById[community.currentUserId] : null;
  const isModerator = currentUser?.role === "moderator" || currentUser?.role === "admin";

  const visiblePosts = useMemo(() => {
    const blockedUserIds = new Set(currentUser?.blockedUserIds ?? []);
    const mutedTags = new Set(currentUser?.mutedTags ?? []);
    const commentPostIds =
      currentUser == null
        ? new Set<number>()
        : new Set(
            community.comments
              .filter((comment) => comment.authorId === currentUser.id && !comment.deleted)
              .map((comment) => comment.postId),
          );

    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return community.posts
      .filter((post) => {
        if (post.deleted) return false;
        if (post.hidden && !isModerator) return false;
        if (blockedUserIds.has(post.authorId)) return false;
        if (post.tags.some((tag) => mutedTags.has(tag))) return false;

        const author = usersById[post.authorId];
        const matchesQuery =
          normalizedQuery.length === 0 ||
          post.title.toLowerCase().includes(normalizedQuery) ||
          post.content.toLowerCase().includes(normalizedQuery) ||
          post.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)) ||
          author?.nickname.toLowerCase().includes(normalizedQuery) ||
          author?.handle.toLowerCase().includes(normalizedQuery);

        const matchesCategory = category === "all" || post.category === category;
        const matchesQuickFilter =
          quickFilter === "all" ||
          (quickFilter === "hot" && post.hot);

        const matchesFeedMode =
          feedMode === "discover" ||
          (feedMode === "bookmarks" &&
            currentUser != null &&
            post.bookmarks.includes(currentUser.id)) ||
          (feedMode === "my_posts" && currentUser != null && post.authorId === currentUser.id) ||
          (feedMode === "my_comments" &&
            currentUser != null &&
            commentPostIds.has(post.id));

        return matchesQuery && matchesCategory && matchesQuickFilter && matchesFeedMode;
      })
      .sort((left, right) => {
        if (feedSort === "latest") {
          return right.createdAt.localeCompare(left.createdAt);
        }

        if (feedSort === "replies") {
          const leftReplies = community.comments.filter((comment) => comment.postId === left.id && !comment.deleted).length;
          const rightReplies = community.comments.filter((comment) => comment.postId === right.id && !comment.deleted).length;
          return rightReplies - leftReplies;
        }

        const leftScore =
          left.likes.length * 2 +
          left.bookmarks.length * 3 +
          left.viewCount / 20 +
          (left.hot ? 14 : 0) +
          (left.pinned ? 10 : 0);
        const rightScore =
          right.likes.length * 2 +
          right.bookmarks.length * 3 +
          right.viewCount / 20 +
          (right.hot ? 14 : 0) +
          (right.pinned ? 10 : 0);

        return rightScore - leftScore;
      });
  }, [
    category,
    community.comments,
    community.posts,
    currentUser,
    deferredQuery,
    feedMode,
    feedSort,
    isModerator,
    quickFilter,
    usersById,
  ]);

  useEffect(() => {
    if (selectedPostId === null) return;
    if (community.posts.some((post) => post.id === selectedPostId && !post.deleted)) return;
    setSelectedPostId(null);
  }, [community.posts, selectedPostId]);

  const selectedPost =
    selectedPostId === null
      ? null
      : (visiblePosts.find((post) => post.id === selectedPostId) ??
         community.posts.find((post) => post.id === selectedPostId && !post.deleted) ??
         null);

  const totalPostPages = Math.max(1, Math.ceil(visiblePosts.length / POSTS_PER_PAGE));
  const currentPostPage = Math.min(postPage, totalPostPages);
  const paginatedPosts = visiblePosts.slice(
    (currentPostPage - 1) * POSTS_PER_PAGE,
    currentPostPage * POSTS_PER_PAGE,
  );

  const selectedAuthor = selectedPost ? usersById[selectedPost.authorId] : null;

  useEffect(() => {
    setPostPage(1);
  }, [category, deferredQuery, feedMode, feedSort, quickFilter]);

  useEffect(() => {
    if (postPage > totalPostPages) {
      setPostPage(totalPostPages);
    }
  }, [postPage, totalPostPages]);

  useEffect(() => {
    if (selectedPostId === null) return;
    if (!paginatedPosts.some((post) => post.id === selectedPostId)) {
      setSelectedPostId(null);
    }
  }, [paginatedPosts, selectedPostId]);

  const postComments = useMemo(() => {
    if (!selectedPost) return [];

    const blockedUserIds = new Set(currentUser?.blockedUserIds ?? []);
    const comments = community.comments
      .filter((comment) => comment.postId === selectedPost.id)
      .filter((comment) => {
        if (comment.deleted) return false;
        if (comment.hidden && !isModerator) return false;
        if (blockedUserIds.has(comment.authorId)) return false;
        return true;
      });

    const score = (comment: CommunityComment) => comment.likes.length + (comment.parentId === null ? 1 : 0);
    const sorter =
      commentSort === "best"
        ? (left: CommunityComment, right: CommunityComment) => score(right) - score(left)
        : (left: CommunityComment, right: CommunityComment) => right.createdAt.localeCompare(left.createdAt);

    const parents = comments.filter((comment) => comment.parentId === null).sort(sorter);
    const children = comments.filter((comment) => comment.parentId !== null).sort(sorter);

    return parents.flatMap((parent) => [
      parent,
      ...children.filter((child) => child.parentId === parent.id),
    ]);
  }, [commentSort, community.comments, currentUser, isModerator, selectedPost]);


const jumpToPostDetail = () => {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const pushFlash = (text: string, tone: FlashTone = "info") => {
    setFlashMessage({ text, tone });
  };

  const appendNotification = (
    recipientId: string,
    notification: Omit<CommunityNotification, "id" | "userId" | "read">,
  ) => {
    setCommunity((previous) => ({
      ...previous,
      notifications: [
        {
          id: previous.notifications.reduce((max, item) => Math.max(max, item.id), 0) + 1,
          userId: recipientId,
          read: false,
          ...notification,
        },
        ...previous.notifications,
      ],
    }));
  };

  const requireAuth = (mode: "read" | "write" | "comment" = "read") => {
    if (!isLoggedIn) {
      pushFlash("로그인한 사용자만 이 기능을 사용할 수 있어요.", "warning");
      navigate("/login");
      return false;
    }

    if (mode === "write" && currentUser?.writeRestricted) {
      pushFlash("현재 글쓰기 권한이 제한된 계정입니다.", "warning");
      return false;
    }

    if (mode === "comment" && currentUser?.commentRestricted) {
      pushFlash("현재 댓글 작성 권한이 제한된 계정입니다.", "warning");
      return false;
    }

    return true;
  };

  const openCreateEditor = () => {
    if (!requireAuth("write")) return;
    setDraft(emptyDraft);
    setEditorMode("create");
    setEditingPostId(null);
    setEditorOpen(true);
  };

  const openEditEditor = (post: CommunityPost) => {
    if (!requireAuth("write")) return;
    if (!currentUser) return;
    if (post.authorId !== currentUser.id && !isModerator) {
      pushFlash("본인 글 또는 운영 권한이 있어야 수정할 수 있어요.", "warning");
      return;
    }

    setDraft({
      title: post.title,
      category: post.category,
      content: post.content,
    });
    setEditorMode("edit");
    setEditingPostId(post.id);
    setEditorOpen(true);
  };

  const publishPost = async () => {
    if (!requireAuth("write")) return;

    const title = draft.title.trim();
    const content = draft.content.trim();
    const tags = [categoryLabels[draft.category]];

    if (title.length < 4 || content.length < 12) {
      pushFlash("제목과 본문을 조금 더 자세히 작성해 주세요.", "warning");
      return;
    }

    try {
      if (editorMode === "edit" && editingPostId != null) {
        const res = await fetch(`${API}/posts/${editingPostId}`, {
          method: "PUT",
          headers: authHeaders(),
          body: JSON.stringify({
            title,
            excerpt: summarize(content),
            content,
            category: draft.category,
          }),
        });
        if (!res.ok) throw new Error("수정 실패");
        const p = await res.json();
        const now = new Date(p.updated_at).toLocaleString("ko-KR").replace(/\. /g, ".").replace(",", "");
        setCommunity((previous) => ({
          ...previous,
          posts: previous.posts.map((post) =>
            post.id === editingPostId
              ? { ...post, title: p.title, excerpt: p.excerpt, content: p.content, category: p.category, tags, updatedAt: now }
              : post,
          ),
        }));
        pushFlash("게시글을 수정했어요.", "success");
      } else {
        const res = await fetch(`${API}/posts`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            title,
            excerpt: summarize(content),
            content,
            category: draft.category,
          }),
        });
        if (!res.ok) throw new Error("등록 실패");
        const p = await res.json();
        const now = new Date(p.created_at).toLocaleString("ko-KR").replace(/\. /g, ".").replace(",", "");
        const newPost: CommunityPost = {
          id: p.post_id,
          authorId: p.user_id,
          title: p.title,
          excerpt: p.excerpt,
          content: p.content,
          category: p.category as Exclude<CommunityCategory, "all">,
          tags,
          createdAt: now,
          updatedAt: now,
          likes: [],
          bookmarks: [],
          viewCount: 0,
          reportCount: 0,
        };
        setCommunity((previous) => ({
          ...previous,
          posts: [newPost, ...previous.posts],
        }));
        setSelectedPostId(p.post_id);
        pushFlash("새 글을 발행했어요.", "success");
      }
    } catch {
      pushFlash("서버 오류가 발생했어요. 서버가 실행 중인지 확인해 주세요.", "warning");
      return;
    }

    setDraft(emptyDraft);
    setEditorOpen(false);
    setEditingPostId(null);
  };


  const togglePostLike = async (postId: number) => {
    if (!requireAuth()) return;

    const target = community.posts.find((post) => post.id === postId);
    if (!target) return;

    const alreadyLiked = target.likes.includes(currentUser!.id);

    try {
      const res = await fetch(`${API}/posts/${postId}/like`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error("좋아요 실패");
      setCommunity((previous) => ({
        ...previous,
        posts: previous.posts.map((post) =>
          post.id === postId
            ? {
                ...post,
                likes: alreadyLiked
                  ? post.likes.filter((id) => id !== currentUser!.id)
                  : [currentUser!.id, ...post.likes],
              }
            : post,
        ),
      }));
    } catch {
      pushFlash("서버 오류가 발생했어요.", "warning");
    }
  };

  const togglePostBookmark = (postId: number) => {
    if (!requireAuth()) return;

    const target = community.posts.find((post) => post.id === postId);
    if (!target) return;

    const alreadyBookmarked = target.bookmarks.includes(currentUser!.id);

    setCommunity((previous) => ({
      ...previous,
      posts: previous.posts.map((post) =>
        post.id === postId
          ? {
              ...post,
              bookmarks: alreadyBookmarked
                ? post.bookmarks.filter((id) => id !== currentUser!.id)
                : [currentUser!.id, ...post.bookmarks],
            }
          : post,
      ),
    }));

    if (!alreadyBookmarked && target.authorId !== currentUser!.id) {
      appendNotification(target.authorId, {
        type: "bookmark",
        text: `${currentUser!.nickname} 님이 회원님의 글을 북마크했어요.`,
        createdAt: "2026.04.04 15:21",
        postId,
      });
    }
  };

  const sharePost = async (post: CommunityPost) => {
    if (!requireAuth()) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/community?post=${post.id}`);
      pushFlash("게시글 링크를 복사했어요.", "success");
    } catch {
      pushFlash("링크 복사에 실패했어요.", "warning");
    }
  };

  const deletePost = (postId: number) => {
    if (!requireAuth("write")) return;
    if (!currentUser) return;
    const target = community.posts.find((post) => post.id === postId);
    if (!target) return;
    if (target.authorId !== currentUser.id && !isModerator) {
      pushFlash("본인 글 또는 운영 권한이 있어야 삭제할 수 있어요.", "warning");
      return;
    }

    setCommunity((previous) => ({
      ...previous,
      posts: previous.posts.map((post) =>
        post.id === postId ? { ...post, deleted: true } : post,
      ),
    }));

    pushFlash("게시글을 삭제했어요.", "success");
  };

  const toggleModerationFlag = (
    postId: number,
    key: "pinned" | "hot" | "hidden",
    label: string,
  ) => {
    if (!isModerator) return;

    setCommunity((previous) => ({
      ...previous,
      posts: previous.posts.map((post) =>
        post.id === postId ? { ...post, [key]: !post[key] } : post,
      ),
    }));

    pushFlash(`${label} 상태를 변경했어요.`, "success");
  };

  const openReport = (type: ReportTargetType, id: string) => {
    if (!requireAuth()) return;
    setReportTarget({ type, id });
    setReportReason(reportReasons[0]);
    setReportDetail("");
    setReportOpen(true);
  };

  const submitReport = () => {
    if (!requireAuth()) return;
    if (!reportTarget) return;

    const nextId = community.reports.reduce((max, report) => Math.max(max, report.id), 0) + 1;

    setCommunity((previous) => ({
      ...previous,
      reports: [
        {
          id: nextId,
          reporterId: currentUser!.id,
          targetType: reportTarget.type,
          targetId: reportTarget.id,
          reason: reportReason,
          detail: reportDetail.trim(),
          createdAt: "2026.04.04 15:22",
          status: "pending",
        },
        ...previous.reports,
      ],
      posts:
        reportTarget.type === "post"
          ? previous.posts.map((post) =>
              String(post.id) === reportTarget.id
                ? { ...post, reportCount: post.reportCount + 1 }
                : post,
            )
          : previous.posts,
    }));

    appendNotification("manager_aurora", {
      type: "report",
      text: `${currentUser!.nickname} 님이 ${reportTarget.type === "post" ? "게시글" : reportTarget.type === "comment" ? "댓글" : "사용자"}을 신고했어요.`,
      createdAt: "2026.04.04 15:22",
      postId: reportTarget.type === "post" ? Number(reportTarget.id) : undefined,
      commentId: reportTarget.type === "comment" ? Number(reportTarget.id) : undefined,
    });

    setReportOpen(false);
    pushFlash("신고를 접수했어요.", "success");
  };


  const submitComment = async () => {
    if (!requireAuth("comment") || !selectedPost) return;
    const content = commentInput.trim();
    if (content.length < 2) {
      pushFlash("댓글 내용을 조금 더 입력해 주세요.", "warning");
      return;
    }

    try {
      const res = await fetch(`${API}/posts/${selectedPost.id}/comments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content, parent_id: null }),
      });
      if (!res.ok) throw new Error("댓글 등록 실패");
      const c = await res.json();
      const now = new Date(c.created_at).toLocaleString("ko-KR").replace(/\. /g, ".").replace(",", "");
      const newComment: CommunityComment = {
        id: c.comment_id,
        postId: c.post_id,
        authorId: c.user_id,
        content: c.content,
        createdAt: now,
        likes: [],
        parentId: null,
      };
      setCommunity((previous) => ({
        ...previous,
        comments: [...previous.comments, newComment],
      }));
      setCommentInput("");
      setHighlightedCommentId(c.comment_id);
      pushFlash("댓글을 남겼어요.", "success");
    } catch {
      pushFlash("서버 오류가 발생했어요.", "warning");
    }
  };

  const submitReply = async (parentCommentId: number) => {
    if (!requireAuth("comment") || !selectedPost) return;

    const content = replyInput.trim();
    if (content.length < 2) {
      pushFlash("답글 내용을 조금 더 입력해 주세요.", "warning");
      return;
    }

    try {
      const res = await fetch(`${API}/posts/${selectedPost.id}/comments`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content, parent_id: parentCommentId }),
      });
      if (!res.ok) throw new Error("답글 등록 실패");
      const c = await res.json();
      const now = new Date(c.created_at).toLocaleString("ko-KR").replace(/\. /g, ".").replace(",", "");
      const newComment: CommunityComment = {
        id: c.comment_id,
        postId: c.post_id,
        authorId: c.user_id,
        content: c.content,
        createdAt: now,
        likes: [],
        parentId: parentCommentId,
      };
      setCommunity((previous) => ({
        ...previous,
        comments: [...previous.comments, newComment],
      }));
      setReplyInput("");
      setReplyTargetId(null);
      setHighlightedCommentId(c.comment_id);
      pushFlash("답글을 남겼어요.", "success");
    } catch {
      pushFlash("서버 오류가 발생했어요.", "warning");
    }
  };

  const toggleCommentLike = (commentId: number) => {
    if (!requireAuth()) return;

    const target = community.comments.find((comment) => comment.id === commentId);
    if (!target) return;
    const alreadyLiked = target.likes.includes(currentUser!.id);

    setCommunity((previous) => ({
      ...previous,
      comments: previous.comments.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              likes: alreadyLiked
                ? comment.likes.filter((id) => id !== currentUser!.id)
                : [currentUser!.id, ...comment.likes],
            }
          : comment,
      ),
    }));

    if (!alreadyLiked && target.authorId !== currentUser!.id) {
      appendNotification(target.authorId, {
        type: "like",
        text: `${currentUser!.nickname} 님이 회원님의 댓글에 공감했어요.`,
        createdAt: "2026.04.04 15:25",
        postId: target.postId,
        commentId,
      });
    }
  };

  const startEditingComment = (comment: CommunityComment) => {
    if (!requireAuth("comment")) return;
    if (!currentUser) return;
    if (comment.authorId !== currentUser.id && !isModerator) {
      pushFlash("본인 댓글 또는 운영 권한이 있어야 수정할 수 있어요.", "warning");
      return;
    }

    setEditingCommentId(comment.id);
    setEditingCommentInput(comment.content);
  };

  const saveEditedComment = (commentId: number) => {
    if (!requireAuth("comment")) return;
    if (!currentUser) return;
    if (editingCommentInput.trim().length < 2) {
      pushFlash("댓글 내용을 조금 더 입력해 주세요.", "warning");
      return;
    }

    setCommunity((previous) => ({
      ...previous,
      comments: previous.comments.map((comment) =>
        comment.id === commentId
          ? {
              ...comment,
              content: editingCommentInput.trim(),
              updatedAt: "2026.04.04 15:26",
            }
          : comment,
      ),
    }));
    setEditingCommentId(null);
    setEditingCommentInput("");
    pushFlash("댓글을 수정했어요.", "success");
  };

  const deleteComment = async (commentId: number) => {
    if (!requireAuth("comment")) return;
    if (!currentUser) return;
    const target = community.comments.find((comment) => comment.id === commentId);
    if (!target) return;
    if (target.authorId !== currentUser.id && !isModerator) {
      pushFlash("본인 댓글 또는 운영 권한이 있어야 삭제할 수 있어요.", "warning");
      return;
    }

    try {
      const res = await fetch(`${API}/comments/${commentId}`, {
        method: "DELETE",
        headers: authHeaders(false),
      });
      if (!res.ok) throw new Error("삭제 실패");
      setCommunity((previous) => ({
        ...previous,
        comments: previous.comments.map((comment) =>
          comment.id === commentId ? { ...comment, deleted: true } : comment,
        ),
      }));
      pushFlash("댓글을 삭제했어요.", "success");
    } catch {
      pushFlash("서버 오류가 발생했어요.", "warning");
    }
  };

  const selectedPostCommentCount = selectedPost
    ? community.comments.filter((comment) => comment.postId === selectedPost.id && !comment.deleted).length
    : 0;

return (
    <div className="community-page page-shell space-y-12">
      {flashMessage && (
        <div
          className="rounded-xl px-4 py-3 text-[0.92rem] font-medium"
          style={{
            background:
              flashMessage.tone === "success"
                ? "rgba(47,133,90,0.12)"
                : flashMessage.tone === "warning"
                  ? "rgba(201,152,45,0.14)"
                  : "rgba(35,178,109,0.10)",
            border:
              flashMessage.tone === "success"
                ? "1px solid rgba(47,133,90,0.24)"
                : flashMessage.tone === "warning"
                  ? "1px solid rgba(201,152,45,0.26)"
                  : "1px solid rgba(59,72,144,0.22)",
            color:
              flashMessage.tone === "success"
                ? "#256b49"
                : flashMessage.tone === "warning"
                  ? "#8b6a17"
                  : "#2c3a83",
          }}
        >
          {flashMessage.text}
        </div>
      )}

      <div className="space-y-5">
        <section
          className="overflow-hidden rounded-[20px] border"
          style={{
            background: "#ffffff",
            borderColor: "#e2e8f0",
            boxShadow: "0 8px 24px rgba(17, 40, 73, 0.06)",
          }}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-4 px-6 py-3"
            style={{ background: "#1e3a8a", color: "#ffffff" }}
          >
            <div className="flex items-center gap-3">
              <span className="text-[0.8rem] font-bold tracking-[0.2em] uppercase text-white/80">
                gallery
              </span>
              <span className="text-[1.05rem] font-semibold">야구 팬 커뮤니티 보드</span>
            </div>
          </div>

          <div className="border-b px-6 py-6" style={{ borderColor: "#e2e8f0", background: "#f8fafc" }}>
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="space-y-3">
                <div>
                  <h1 className="text-[2rem] font-bold tracking-[-0.05em]" style={{ color: "#1f2a44" }}>
                    커뮤니티
                  </h1>
                </div>
              </div>

              <div className="flex w-full max-w-[520px] flex-col gap-3">
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "#64748b" }} />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="통합 검색"
                    className="h-12 w-full rounded-[12px] border bg-white pl-11 pr-4 text-[0.94rem] outline-none"
                    style={{ borderColor: "#cbd5e1", color: "#0f172a", background: "#ffffff" }}
                  />
                </div>
              </div>
            </div>
          </div>

        </section>

        <div className="community-main-layout flex items-start gap-5">

          {/* 카테고리 사이드바 */}
          <div className="community-category-sidebar w-36 flex-shrink-0 overflow-hidden rounded-[6px] border" style={{ borderColor: "#cfd7e3" }}>
            <div className="community-category-title px-4 py-3" style={{ background: "#4f5d84" }}>
              <span className="text-[0.82rem] font-bold tracking-wide text-white">카테고리</span>
            </div>
            <div className="community-category-list flex flex-col">
              {Object.entries(categoryLabels).map(([key, label]) => {
                const active = category === key;
                return (
                  <button
                    key={key}
                    onClick={() => setCategory(key as CommunityCategory)}
                    className="community-category-button px-4 py-2.5 text-left text-[0.85rem] font-medium transition-colors"
                    style={{
                      background: active ? "#eef1f8" : "#ffffff",
                      color: active ? "#2c3a83" : "#44526c",
                      borderBottom: "1px solid #e8ecf3",
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="community-content min-w-0 flex-1 space-y-5">
            {selectedPost && selectedAuthor && (
              <>
                <section
                  ref={detailSectionRef}
                  className="overflow-hidden rounded-[6px] border"
                  style={{ background: "#f9fbfc", borderColor: "#cfd7e3" }}
                >
                  <div
                    className="flex items-center justify-between px-6 py-3"
                    style={{ background: "#eef2f8", borderBottom: "1px solid #d9deea" }}
                  >
                    <span className="text-[0.82rem] font-semibold" style={{ color: "#2c3a83" }}>글 상세보기</span>
                    <button
                      onClick={() => setSelectedPostId(null)}
                      className="px-3 py-1.5 text-[0.78rem] font-semibold"
                      style={{ background: "#f8fafc", border: "1px solid #cfd7e6", color: "#44526c" }}
                    >
                      ← 목록으로
                    </button>
                  </div>
                  <div className="px-6 py-5" style={{ borderBottom: "1px solid #dfe5ef" }}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {selectedPost.pinned && (
                        <span
                          className="px-2.5 py-1 text-[0.72rem] font-bold"
                          style={{ background: "#fef4db", border: "1px solid #f2d37a", color: "#9e7423" }}
                        >
                          공지
                        </span>
                      )}
                      {selectedPost.hot && (
                        <span
                          className="px-2.5 py-1 text-[0.72rem] font-bold"
                          style={{ background: "#ffe9e9", border: "1px solid #f2bbbb", color: "#cc5050" }}
                        >
                          개념글
                        </span>
                      )}
                      <span
                        className="px-2.5 py-1 text-[0.72rem] font-bold"
                        style={{
                          background: "#eef2fa",
                          border: "1px solid #cdd6e8",
                          color: categoryAccent[selectedPost.category],
                        }}
                      >
                        {categoryLabels[selectedPost.category]}
                      </span>
                      {selectedPost.verifiedReview && (
                        <span
                          className="px-2.5 py-1 text-[0.72rem] font-bold"
                          style={{ background: "#edf8f2", border: "1px solid #bfdcc8", color: "#2f855a" }}
                        >
                          인증 후기
                        </span>
                      )}
                    </div>

                    <h2 className="text-[1.42rem] font-bold tracking-[-0.04em]" style={{ color: "#1f2a44" }}>
                      {selectedPost.title}
                    </h2>

                    <div
                      className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.82rem]"
                      style={{ color: "#66728d" }}
                    >
                      <span>{selectedAuthor.nickname}</span>
                      <span>@{selectedAuthor.handle}</span>
                      <span>{selectedPost.createdAt}</span>
                      <span>조회 {selectedPost.viewCount}</span>
                      <span>추천 {selectedPost.likes.length}</span>
                      <span>댓글 {selectedPostCommentCount}</span>
                    </div>
                  </div>

                  <div className="px-6 py-7" style={{ borderBottom: "1px solid #dfe5ef" }}>
                    <p className="whitespace-pre-line text-[0.96rem] leading-8" style={{ color: "#2d3a54" }}>
                      {selectedPost.content}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2 px-6 pt-5">
                    {selectedPost.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-1 text-[0.74rem] font-medium"
                        style={{ background: "#f5f7fb", border: "1px solid #dbe2ef", color: "#5f6d88" }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2 px-6 py-5" style={{ borderTop: "1px solid #eef2f7" }}>
                    <Button
                      className="h-10 rounded-[4px] px-4 font-semibold"
                      style={{
                        background: selectedPost.likes.includes(currentUser?.id ?? "") ? "#526183" : "#f8fafc",
                        border: selectedPost.likes.includes(currentUser?.id ?? "") ? "1px solid #526183" : "1px solid #c7cfdf",
                        color: selectedPost.likes.includes(currentUser?.id ?? "") ? "#ffffff" : "#44526c",
                      }}
                      onClick={() => togglePostLike(selectedPost.id)}
                    >
                      <Heart className="h-4 w-4" />
                      추천 {selectedPost.likes.length}
                    </Button>
                    <Button
                      className="h-10 rounded-[4px] px-4 font-semibold"
                      variant="outline"
                      style={{
                        background: "#f8fafc",
                        borderColor: "#c7cfdf",
                        color: "#44526c",
                      }}
                      onClick={() => togglePostBookmark(selectedPost.id)}
                    >
                      {selectedPost.bookmarks.includes(currentUser?.id ?? "") ? (
                        <BookmarkCheck className="h-4 w-4" />
                      ) : (
                        <Bookmark className="h-4 w-4" />
                      )}
                      북마크 {selectedPost.bookmarks.length}
                    </Button>
                    <Button
                      className="h-10 rounded-[4px] px-4 font-semibold"
                      variant="outline"
                      style={{
                        background: "#f8fafc",
                        borderColor: "#c7cfdf",
                        color: "#44526c",
                      }}
                      onClick={() => {
                        if (!requireAuth("comment")) return;
                        setHighlightedCommentId(postComments[0]?.id ?? null);
                      }}
                    >
                      <MessageSquareText className="h-4 w-4" />
                      댓글 보기
                    </Button>
                    <Button
                      className="h-10 rounded-[4px] px-4 font-semibold"
                      variant="outline"
                      style={{
                        background: "#f8fafc",
                        borderColor: "#c7cfdf",
                        color: "#44526c",
                      }}
                      onClick={() => sharePost(selectedPost)}
                    >
                      <Copy className="h-4 w-4" />
                      링크
                    </Button>
                    <Button
                      className="h-10 rounded-[4px] px-4 font-semibold"
                      variant="outline"
                      style={{
                        background: "#f8fafc",
                        borderColor: "#c7cfdf",
                        color: "#44526c",
                      }}
                      onClick={() => openReport("post", String(selectedPost.id))}
                    >
                      <Flag className="h-4 w-4" />
                      신고
                    </Button>
                  </div>

                  {isLoggedIn && (currentUser?.id === selectedPost.authorId || isModerator) && (
                    <div className="flex flex-wrap gap-2 px-6 pb-6">
                      <Button
                        className="h-9 rounded-[4px] px-3"
                        variant="outline"
                        style={{ background: "#f8fafc", borderColor: "#c7cfdf", color: "#44526c" }}
                        onClick={() => openEditEditor(selectedPost)}
                      >
                        <Pencil className="h-4 w-4" />
                        수정
                      </Button>
                      <Button
                        className="h-9 rounded-[4px] px-3"
                        variant="outline"
                        style={{ background: "#fff7eb", borderColor: "#f0d59e", color: "#9b7425" }}
                        onClick={() => deletePost(selectedPost.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        삭제
                      </Button>
                      {isModerator && (
                        <>
                          <Button
                            className="h-9 rounded-[4px] px-3"
                            variant="outline"
                            style={{ background: "#f8fafc", borderColor: "#c7cfdf", color: "#44526c" }}
                            onClick={() => toggleModerationFlag(selectedPost.id, "pinned", "고정")}
                          >
                            <Pin className="h-4 w-4" />
                            고정
                          </Button>
                          <Button
                            className="h-9 rounded-[4px] px-3"
                            variant="outline"
                            style={{ background: "#eef2fa", borderColor: "#ccd6ea", color: "#2c3a83" }}
                            onClick={() => toggleModerationFlag(selectedPost.id, "hot", "인기글")}
                          >
                            <Flame className="h-4 w-4" />
                            개념글
                          </Button>
                          <Button
                            className="h-9 rounded-[4px] px-3"
                            variant="outline"
                            style={{ background: "#fff7eb", borderColor: "#f0d59e", color: "#9b7425" }}
                            onClick={() => toggleModerationFlag(selectedPost.id, "hidden", "숨김")}
                          >
                            <Eye className="h-4 w-4" />
                            숨김
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </section>

                <section
                  className="overflow-hidden rounded-[6px] border"
                  style={{ background: "#f9fbfc", borderColor: "#cfd7e3" }}
                >
                  <div
                    className="flex flex-wrap items-center justify-between gap-3 px-6 py-4"
                    style={{ background: "#f8f9fc", borderBottom: "1px solid #dfe5ef" }}
                  >
                    <div>
                      <h3 className="text-[1.08rem] font-bold" style={{ color: "#1f2a44" }}>댓글</h3>
                      <p className="mt-1 text-[0.82rem]" style={{ color: "#66728d" }}>
                        본문 아래에서 바로 답글과 공감을 이어가는 게시판형 댓글 영역입니다.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {Object.entries(commentSortLabels).map(([key, label]) => {
                        const active = commentSort === key;
                        return (
                          <button
                            key={key}
                            onClick={() => setCommentSort(key as CommentSort)}
                            className="px-3 py-1.5 text-[0.76rem] font-semibold"
                            style={{
                              background: active ? "#526183" : "#f8fafc",
                              border: active ? "1px solid #526183" : "1px solid #ced5e3",
                              color: active ? "#ffffff" : "#5f6d88",
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="px-6 py-5" style={{ borderBottom: "1px solid #e7ebf3" }}>
                    {!isLoggedIn && (
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[6px] px-4 py-3 text-[0.85rem]" style={{ background: "#f0f3f8", border: "1px solid #dbe2ef", color: "#60708f" }}>
                        <span>로그인 후 댓글을 작성할 수 있어요.</span>
                        <button
                          type="button"
                          onClick={() => navigate("/login")}
                          className="rounded-[4px] px-3 py-2 text-[0.78rem] font-bold"
                          style={{ background: "#526183", color: "#ffffff" }}
                        >
                          로그인하기
                        </button>
                      </div>
                    )}
                    {isLoggedIn && (
                      <>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2 text-[0.8rem]" style={{ color: "#6c7893" }}>
                            <span>댓글, 답글, 멘션이 바로 이어집니다.</span>
                            {selectedAuthor && (
                              <button
                                onClick={() => setCommentInput(`@${selectedAuthor.handle} `)}
                                className="px-2.5 py-1 font-semibold"
                                style={{ background: "#f5f7fb", border: "1px solid #dbe2ef", color: "#44526c" }}
                              >
                                작성자 멘션 넣기
                              </button>
                            )}
                          </div>
                          <span className="text-[0.76rem]" style={{ color: "#73809b" }}>
                            {commentInput.trim().length}자
                          </span>
                        </div>
                        <textarea
                          value={commentInput}
                          onChange={(event) => setCommentInput(event.target.value)}
                          placeholder="@handle 형식으로 멘션할 수 있어요. 거래 후기나 질문을 남겨보세요."
                          className="min-h-[108px] w-full resize-none border bg-white px-4 py-4 text-[0.92rem] outline-none"
                          style={{ borderColor: "#c7cfdf", color: "#22314d" }}
                        />
                        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
                          <Button
                            className="h-10 rounded-[4px] px-4 font-semibold text-white"
                            style={{ background: "#3b4890" }}
                            onClick={submitComment}
                            disabled={commentInput.trim().length < 2}
                          >
                            <Send className="h-4 w-4" />
                            댓글 등록
                          </Button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="divide-y" style={{ borderColor: "#edf1f6" }}>
                    {postComments.map((comment) => {
                      const author = usersById[comment.authorId];
                      const isReply = comment.parentId !== null;
                      const canManageComment =
                        isLoggedIn && currentUser != null && (comment.authorId === currentUser.id || isModerator);
                      const isHighlighted = highlightedCommentId === comment.id;

                      return (
                        <div
                          key={comment.id}
                          className="px-6 py-5"
                          style={{
                            background: isHighlighted ? "#f5f7fd" : "#ffffff",
                            borderLeft: isReply ? "3px solid #d7dded" : "3px solid transparent",
                            paddingLeft: isReply ? "2rem" : "1.5rem",
                          }}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex flex-wrap items-center gap-2 text-[0.8rem]" style={{ color: "#6b7792" }}>
                                <span className="font-semibold" style={{ color: "#22314d" }}>{author?.nickname}</span>
                                <span>@{author?.handle}</span>
                                {badgeList(author!).slice(0, 2).map((badge) => {
                                  const Icon = badge.icon;
                                  return (
                                    <span
                                      key={badge.label}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[0.7rem]"
                                      style={{
                                        background: "#f5f7fb",
                                        border: "1px solid #dbe2ef",
                                        color: badge.color,
                                      }}
                                    >
                                      <Icon className="h-3 w-3" />
                                      {badge.label}
                                    </span>
                                  );
                                })}
                                <span>{comment.createdAt}</span>
                                {comment.updatedAt && <span>수정됨</span>}
                              </div>

                              {editingCommentId === comment.id ? (
                                <div className="space-y-3">
                                  <textarea
                                    value={editingCommentInput}
                                    onChange={(event) => setEditingCommentInput(event.target.value)}
                                    className="min-h-[96px] w-full resize-none border bg-white px-4 py-3 outline-none"
                                    style={{ borderColor: "#c7cfdf", color: "#22314d" }}
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      className="h-9 rounded-[4px] px-4 font-semibold text-white"
                                      style={{ background: "#3b4890" }}
                                      onClick={() => saveEditedComment(comment.id)}
                                    >
                                      저장
                                    </Button>
                                    <Button
                                      className="h-9 rounded-[4px] px-4"
                                      variant="outline"
                                      style={{ background: "#ffffff", borderColor: "#c7cfdf", color: "#44526c" }}
                                      onClick={() => {
                                        setEditingCommentId(null);
                                        setEditingCommentInput("");
                                      }}
                                    >
                                      취소
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <p className="whitespace-pre-line text-[0.92rem] leading-7" style={{ color: "#2d3a54" }}>
                                  {comment.content}
                                </p>
                              )}

                              <div className="mt-4 flex flex-wrap gap-2">
                                <Button
                                  className="h-8 rounded-[4px] px-3"
                                  variant="outline"
                                  style={{
                                    background: "#ffffff",
                                    borderColor: "#c7cfdf",
                                    color: comment.likes.includes(currentUser?.id ?? "") ? "#2c3a83" : "#44526c",
                                  }}
                                  onClick={() => toggleCommentLike(comment.id)}
                                >
                                  <Heart className="h-4 w-4" />
                                  {comment.likes.length}
                                </Button>
                                <Button
                                  className="h-8 rounded-[4px] px-3"
                                  variant="outline"
                                  style={{ background: "#f6f8fc", borderColor: "#d5dceb", color: "#44526c" }}
                                  onClick={() => {
                                    if (!requireAuth("comment")) return;
                                    setReplyTargetId(comment.id);
                                    setReplyInput(`@${author?.handle} `);
                                  }}
                                >
                                  <MessagesSquare className="h-4 w-4" />
                                  답글
                                </Button>
                                <Button
                                  className="h-8 rounded-[4px] px-3"
                                  variant="outline"
                                  style={{ background: "#ffffff", borderColor: "#c7cfdf", color: "#44526c" }}
                                  onClick={() => openReport("comment", String(comment.id))}
                                >
                                  <Flag className="h-4 w-4" />
                                  신고
                                </Button>
                                {canManageComment && editingCommentId !== comment.id && (
                                  <>
                                    <Button
                                      className="h-8 rounded-[4px] px-3"
                                      variant="outline"
                                      style={{ background: "#ffffff", borderColor: "#c7cfdf", color: "#44526c" }}
                                      onClick={() => startEditingComment(comment)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                      수정
                                    </Button>
                                    <Button
                                      className="h-8 rounded-[4px] px-3"
                                      variant="outline"
                                      style={{ background: "#fff7eb", borderColor: "#f0d59e", color: "#9b7425" }}
                                      onClick={() => deleteComment(comment.id)}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                      삭제
                                    </Button>
                                  </>
                                )}
                              </div>

                              {replyTargetId === comment.id && (
                                <div
                                  className="mt-4 border bg-[#fafbfe] px-4 py-4"
                                  style={{ borderColor: "#d6ddeb" }}
                                >
                                  <textarea
                                    value={replyInput}
                                    onChange={(event) => setReplyInput(event.target.value)}
                                    className="min-h-[88px] w-full resize-none bg-transparent outline-none"
                                    style={{ color: "#22314d" }}
                                    placeholder="답글을 입력하세요"
                                  />
                                  <div className="mt-3 flex gap-2">
                                    <Button
                                      className="h-9 rounded-[4px] px-4 font-semibold text-white"
                                      style={{ background: "#3b4890" }}
                                      onClick={() => submitReply(comment.id)}
                                    >
                                      <Send className="h-4 w-4" />
                                      답글 등록
                                    </Button>
                                    <Button
                                      className="h-9 rounded-[4px] px-4"
                                      variant="outline"
                                      style={{ background: "#ffffff", borderColor: "#c7cfdf", color: "#44526c" }}
                                      onClick={() => {
                                        setReplyTargetId(null);
                                        setReplyInput("");
                                      }}
                                    >
                                      취소
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </>
            )}
            <section
              className="community-board-section overflow-hidden rounded-[6px] border flex flex-col"
              style={{ background: "#f9fbfc", borderColor: "#cfd7e3" }}
            >
              <div
                className="community-list-toolbar flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-[0.8rem]"
                style={{ background: "#eef2f8", borderBottom: "1px solid #d9deea", color: "#5f6d88" }}
              >
                <div className="community-sort-controls flex flex-wrap items-center gap-2">
                  {Object.entries(feedSortLabels).map(([key, label]) => {
                    const active = feedSort === key;
                    return (
                      <button
                        key={key}
                        onClick={() => setFeedSort(key as FeedSort)}
                        className="px-3 py-1.5 font-semibold"
                        style={{
                          background: active ? "#526183" : "#f8fafc",
                          border: active ? "1px solid #526183" : "1px solid #ced5e3",
                          color: active ? "#ffffff" : "#5f6d88",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>


              <div
                className="hidden md:grid grid-cols-[100px_minmax(0,1fr)_130px_100px_70px_70px] items-center gap-3 px-5 py-3 text-[0.74rem] font-bold"
                style={{ background: "#f8f9fc", borderBottom: "1px solid #dfe5ef", color: "#5f6d88" }}
              >
                <span>태그</span>
                <span>제목</span>
                <span>글쓴이</span>
                <span>작성일</span>
                <span>추천</span>
                <span>조회</span>
              </div>

              <div className="flex-1">
              {visiblePosts.length === 0 ? (
                <div className="px-6 py-12">
                  <p className="text-[1rem] font-semibold" style={{ color: "#21304f" }}>조건에 맞는 글이 없어요.</p>
                  <p className="mt-2 text-[0.88rem]" style={{ color: "#60708f" }}>
                    검색어와 필터를 조금 넓혀보거나, 새 글로 첫 흐름을 만들어볼 수 있습니다.
                  </p>
                </div>
              ) : (
                paginatedPosts.map((post, index) => {
                  const author = usersById[post.authorId];
                  const commentCount = community.comments.filter(
                    (comment) => comment.postId === post.id && !comment.deleted,
                  ).length;
                  const isSelected = selectedPost?.id === post.id;

                  return (
                    <motion.button
                      key={post.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.015 }}
                      onClick={() => {
                        setSelectedPostId(post.id);
                        setHighlightedCommentId(null);
                        jumpToPostDetail();
                      }}
                      className="w-full text-left transition-colors"
                      style={{
                        background: isSelected ? "#eef2f6" : "#f9fbfc",
                        borderBottom: "1px solid #edf1f6",
                      }}
                    >
                      <div className="hidden md:grid grid-cols-[100px_minmax(0,1fr)_130px_100px_70px_70px] items-start gap-3 px-5 py-3">
                        <span className="text-[0.79rem] font-semibold" style={{ color: categoryAccent[post.category] }}>
                          {categoryLabels[post.category]}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[0.92rem] font-medium" style={{ color: "#1f2a44" }}>
                            {post.title}
                            {commentCount > 0 && (
                              <span className="ml-2 text-[0.8rem] font-semibold" style={{ color: "#d14b4b" }}>
                                [{commentCount}]
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block truncate text-[0.78rem]" style={{ color: "#6c7893" }}>
                            {post.pinned ? "[공지] " : post.hot ? "[개념글] " : ""}
                            {post.excerpt}
                          </span>
                        </span>
                        <span className="block truncate text-[0.8rem]" style={{ color: "#405170" }}>
                          {author?.nickname}
                        </span>
                        <span className="text-[0.78rem]" style={{ color: "#73809b" }}>
                          {post.createdAt.slice(5)}
                        </span>
                        <span className="text-[0.78rem]" style={{ color: "#73809b" }}>
                          {post.likes.length}
                        </span>
                        <span className="text-[0.78rem]" style={{ color: "#73809b" }}>
                          {post.viewCount}
                        </span>
                      </div>

                      <div className="community-mobile-post md:hidden px-4 py-4 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-[0.74rem]">
                          <span className="font-semibold" style={{ color: categoryAccent[post.category] }}>
                            {categoryLabels[post.category]}
                          </span>
                          <span style={{ color: "#73809b" }}>{post.pinned ? "공지" : ""}</span>
                          <span style={{ color: "#73809b" }}>{post.createdAt.slice(5)}</span>
                        </div>
                        <p className="text-[0.95rem] font-semibold leading-6" style={{ color: "#1f2a44" }}>
                          {post.title}
                          {commentCount > 0 && (
                            <span className="ml-2 text-[0.8rem]" style={{ color: "#d14b4b" }}>
                              [{commentCount}]
                            </span>
                          )}
                        </p>
                        <p className="text-[0.8rem] leading-6" style={{ color: "#6c7893" }}>
                          {post.excerpt}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-[0.76rem]" style={{ color: "#73809b" }}>
                          <span>{author?.nickname}</span>
                          <span>조회 {post.viewCount}</span>
                          <span>추천 {post.likes.length}</span>
                        </div>
                      </div>
                    </motion.button>
                  );
                })
              )}
              </div>

              <div
                className="community-pagination-area flex flex-col items-center gap-4 px-5 py-5"
                style={{ background: "#fcfdff", borderTop: "1px solid #e4e9f2" }}
              >
                <div className="community-pagination-controls flex items-center gap-2">
                  <button
                    onClick={() => setPostPage((page) => Math.max(1, page - 1))}
                    disabled={currentPostPage === 1}
                    className="px-3 py-1.5 text-[0.78rem] font-semibold disabled:cursor-not-allowed"
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #cfd7e6",
                      color: currentPostPage === 1 ? "#a8b2c5" : "#44526c",
                    }}
                  >
                    이전
                  </button>
                  {Array.from({ length: totalPostPages }, (_, index) => index + 1).map((page) => {
                    const active = page === currentPostPage;
                    return (
                      <button
                        key={page}
                        onClick={() => setPostPage(page)}
                        className="min-w-9 px-3 py-1.5 text-[0.78rem] font-semibold"
                        style={{
                          background: active ? "#526183" : "#f8fafc",
                          border: active ? "1px solid #526183" : "1px solid #cfd7e6",
                          color: active ? "#ffffff" : "#44526c",
                        }}
                      >
                        {page}
                      </button>
                    );
                  })}
                  <button
                    onClick={() => setPostPage((page) => Math.min(totalPostPages, page + 1))}
                    disabled={currentPostPage === totalPostPages}
                    className="px-3 py-1.5 text-[0.78rem] font-semibold disabled:cursor-not-allowed"
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #cfd7e6",
                      color: currentPostPage === totalPostPages ? "#a8b2c5" : "#44526c",
                    }}
                  >
                    다음
                  </button>
                </div>

                <div className="community-bottom-search relative w-full max-w-2xl">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="통합 검색"
                    className="h-11 w-full rounded-[4px] border bg-white pl-4 pr-12 text-[0.94rem] outline-none"
                    style={{ borderColor: "#3b4890", color: "#20304e", background: "#fcfdfe" }}
                  />
                  <button
                    className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-r-[4px]"
                    style={{ background: "#3b4890" }}
                    onClick={() => {}}
                  >
                    <Search className="h-4 w-4 text-white" />
                  </button>
                </div>
              </div>
            </section>

          </div>


        </div>
      </div>


      {/* 플로팅 글쓰기 버튼 */}
      {isLoggedIn && (
        <button
          onClick={openCreateEditor}
          className="community-write-fab fixed right-8 z-40 flex items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
          style={{ background: "#4f5d84", color: "#ffffff", bottom: "24px", right: "24px", width: "64px", height: "64px" }}
        >
          <CiCirclePlus style={{ width: "36px", height: "36px" }} />
        </button>
      )}

      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm overflow-y-auto" style={{ paddingTop: "72px" }}>
          <div className="min-h-full flex items-start justify-center p-4 pb-8">
            <div
              className="relative w-full max-w-4xl rounded-[8px] border p-6"
              style={{ borderColor: "#cfd7e3", background: "#f8fafc", boxShadow: "0 16px 40px rgba(18, 26, 44, 0.16)" }}
            >
              <button
                onClick={() => setEditorOpen(false)}
                className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-[4px] border"
                style={{ background: "#ffffff", borderColor: "#d3daea", color: "#50607d" }}
              >
                <X className="w-4 h-4" />
              </button>
              <div className="mb-5">
                <h3 className="section-title" style={{ color: "#1f2a44" }}>{editorMode === "create" ? "새 글 작성" : "게시글 수정"}</h3>
              </div>

              <div className="space-y-4">
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((previous) => ({ ...previous, title: event.target.value }))}
                  placeholder="제목"
                  className="w-full rounded-[4px] px-4 py-3.5 outline-none"
                  style={{ border: "1px solid #c7cfdf", background: "#fcfdfe", color: "#20304e" }}
                />

                <div className="flex flex-wrap gap-2">
                  {(["ticket", "fragment", "baseball", "strategy"] as Exclude<CommunityCategory, "all">[]).map((cat) => {
                    const selected = draft.category === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setDraft((previous) => ({ ...previous, category: cat }))}
                        className="rounded-[4px] px-4 py-2 text-[0.88rem] font-semibold transition-colors"
                        style={{
                          background: selected ? `${categoryAccent[cat]}18` : "#f2f4f8",
                          border: `1.5px solid ${selected ? categoryAccent[cat] : "#dbe2ef"}`,
                          color: selected ? categoryAccent[cat] : "#6b7a96",
                        }}
                      >
                        {categoryLabels[cat]}
                      </button>
                    );
                  })}
                </div>

                {(draft.category === "ticket" || draft.category === "fragment") && (
                  <div>
                    <label className="block mb-1.5 text-[0.82rem] font-semibold" style={{ color: "#4f627a" }}>
                      {draft.category === "ticket" ? "티켓 링크 / 거래 연락처" : "마켓 링크"}
                    </label>
                    <input
                      value={draft.externalLink ?? ""}
                      onChange={(event) => setDraft((previous) => ({ ...previous, externalLink: event.target.value }))}
                      placeholder={draft.category === "ticket" ? "티켓 링크 또는 오픈채팅 URL을 입력하세요 (선택)" : "마켓 상품 URL을 입력하세요 (선택)"}
                      className="w-full rounded-[4px] px-4 py-3 outline-none text-[0.88rem]"
                      style={{ border: "1px solid #c7cfdf", background: "#fcfdfe", color: "#20304e" }}
                    />
                  </div>
                )}

                <textarea
                  value={draft.content}
                  onChange={(event) => setDraft((previous) => ({ ...previous, content: event.target.value }))}
                  placeholder="@handle 멘션, 거래 체결가, 운영 후기 등을 자유롭게 적어보세요."
                  className="w-full min-h-[300px] resize-none rounded-[4px] px-4 py-3.5 outline-none"
                  style={{ border: "1px solid #c7cfdf", background: "#fcfdfe", color: "#20304e" }}
                />

              </div>

              <div className="flex flex-wrap justify-end gap-2 mt-6">
                <Button
                  className="rounded-[4px] text-white"
                  style={{ background: "#526183" }}
                  onClick={publishPost}
                >
                  {editorMode === "create" ? "등록하기" : "수정 완료"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reportOpen && (
        <div className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm p-4 flex items-center justify-center">
          <div
            className="relative w-full max-w-xl rounded-[8px] border p-6"
            style={{ borderColor: "#cfd7e3", background: "#f8fafc", boxShadow: "0 16px 38px rgba(18, 26, 44, 0.16)" }}
          >
            <button
              onClick={() => setReportOpen(false)}
              className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-[4px] border"
              style={{ background: "#ffffff", borderColor: "#d3daea", color: "#50607d" }}
            >
              <X className="w-4 h-4" />
            </button>
            <div className="mb-5">
              <h3 className="section-title" style={{ color: "#1f2a44" }}>신고 접수</h3>
              <p className="page-muted mt-2" style={{ color: "#60708f" }}>광고, 허위 정보, 시세 조작 유도, 개인정보 노출 등 신고 사유를 선택해 주세요.</p>
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {reportReasons.map((reason) => {
                  const active = reportReason === reason;
                  return (
                    <button
                      key={reason}
                      onClick={() => setReportReason(reason)}
                      className="rounded-[4px] px-3 py-2 text-[0.78rem] font-semibold transition-all"
                      style={{
                        background: active ? "#eef2fa" : "#ffffff",
                        border: active
                          ? "1px solid #c9d3e8"
                          : "1px solid #dbe2ef",
                        color: active ? "#2c3a83" : "#60708f",
                      }}
                    >
                      {reason}
                    </button>
                  );
                })}
              </div>

              <textarea
                value={reportDetail}
                onChange={(event) => setReportDetail(event.target.value)}
                placeholder="추가 설명이 있다면 적어주세요."
                className="w-full min-h-[140px] resize-none rounded-[4px] px-4 py-3.5 outline-none"
                style={{ border: "1px solid #c7cfdf", background: "#ffffff", color: "#20304e" }}
              />
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Button
                variant="outline"
                className="rounded-[4px]"
                style={{ background: "#ffffff", borderColor: "#c7cfdf", color: "#44526c" }}
                onClick={() => setReportOpen(false)}
              >
                취소
              </Button>
              <Button
                className="rounded-[4px] text-white"
                style={{ background: "#3b4890" }}
                onClick={submitReport}
              >
                신고 제출
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
