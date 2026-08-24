require('dotenv').config();
const mysql  = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  multipleStatements: true,
};

const DB_NAME = "ticketblockchain";

// ─── 시드 데이터 ──────────────────────────────────────────

const SEED_USERS = [
  { user_id: "admin_01",  nickname: "BASE CHAIN 운영팀" },
  { user_id: "user_bh",   nickname: "Baseball Hunter" },
  { user_id: "user_tm",   nickname: "Ticket Mint" },
  { user_id: "viewer",    nickname: "나" },
];

const SEED_POSTS = [
  {
    user_id:  "user_bh",
    title:    "2026 개막 시리즈 1루 지정석 양도합니다",
    excerpt:  "개인 사정으로 못 가게 됐어요. 정가 양도합니다. 자세한 건 댓글로요.",
    content:  "개인 사정으로 개막 시리즈 2경기를 못 가게 됐습니다.\n1루 지정석 2연석이고 정가 그대로 양도합니다.\n직거래 또는 플랫폼 내 공식 양도 방식으로 진행할게요.\n댓글이나 쪽지 주세요.",
    category: "ticket",
  },
  {
    user_id:  "viewer",
    title:    "잠실 주말 경기 티켓 급하게 구합니다",
    excerpt:  "이번 주말 잠실 경기 티켓 1장만 구합니다. 구역 상관없어요.",
    content:  "이번 주말 잠실 경기 갑자기 같이 가게 됐는데 티켓이 1장 부족합니다.\n구역은 상관없고 1장만 구합니다.\n연락 주시면 바로 확인할게요.",
    category: "ticket",
  },
  {
    user_id:  "user_tm",
    title:    "두산 홈런볼 카드 18,500원에 올렸어요",
    excerpt:  "현재 마켓 최저가 근처입니다. 거래량 붙는 거 확인하고 올렸어요.",
    content:  "두산 홈런볼 카드 1장을 18,500원에 등록했습니다.\n현재 최저가 근처라서 빠르게 나갈 것 같아요.\n거래량이 붙는 타이밍이라 관심 있으신 분은 바로 확인해 보세요.",
    category: "fragment",
  },
  {
    user_id:  "user_bh",
    title:    "LG 승리 배지 2개 세트로 판매합니다",
    excerpt:  "따로 팔기엔 애매해서 2개 묶음으로 올립니다. 합리적인 가격으로.",
    content:  "LG 승리 배지가 2개 있는데 1개짜리 매물이 너무 많아서 2개 묶어서 올립니다.\n개별 최저가 합산보다 조금 낮게 책정했어요.\n관심 있으신 분 댓글 주세요.",
    category: "fragment",
  },
  {
    user_id:  "admin_01",
    title:    "직관 처음 가는데 뭐 챙겨야 하나요?",
    excerpt:  "이번 시즌 처음으로 직관 갑니다. 선배 팬분들 조언 부탁드려요.",
    content:  "야구 직관은 처음인데 이번 주말에 처음 가게 됐습니다.\n응원 도구는 현장에서 사도 되나요? 음식 반입은 어떻게 되는지, 자리에 일찍 가야 하는지도 궁금합니다.\n경험 많으신 분들 조언 부탁드립니다.",
    category: "baseball",
  },
  {
    user_id:  "user_tm",
    title:    "롯데 원정 응원 분위기 어떤가요?",
    excerpt:  "부산 사직 말고 원정 응원 가보신 분 후기 궁금합니다.",
    content:  "평소에 사직 홈경기 위주로 봤는데 이번엔 원정 응원을 가보려고 합니다.\n원정 응원석 분위기나 주의할 점 있으면 알려주세요.\n잠실 원정 응원 가보신 분 계신가요?",
    category: "baseball",
  },
  {
    user_id:  "user_bh",
    title:    "개막 이후 카드 시세 흐름 패턴 정리",
    excerpt:  "매년 반복되는 개막 직후 시세 흐름을 정리해봤습니다.",
    content:  "개막 시리즈가 끝나고 나면 카드 시세가 일정한 패턴을 보이더라고요.\n1. 개막 직후 2~3일은 거래량이 급등하고 가격도 같이 오릅니다.\n2. 첫 주 후반부터 매물이 쌓이면서 횡보 구간이 옵니다.\n3. 첫 주말 홈경기 공지가 붙으면 다시 한 번 단기 급등 가능성이 있습니다.\n이 흐름을 활용해서 1~2번 구간에 매수, 3번 구간에 매도하는 게 가장 무난했습니다.",
    category: "strategy",
  },
  {
    user_id:  "user_tm",
    title:    "팬팩 개봉 직후 바로 팔면 손해인 이유",
    excerpt:  "개봉 직후 매물이 몰리면서 가격이 일시적으로 내려가는 구간이 있어요.",
    content:  "팬팩 개봉 이벤트가 있는 날은 많은 사람이 동시에 개봉하면서 매물이 한꺼번에 쏟아집니다.\n이때 바로 올리면 최저가 경쟁에 끌려다니게 돼요.\n개인적으로는 개봉 당일보다 1~2일 후에 올리는 게 체감 정산가가 더 좋았습니다.\n급하게 팔 이유가 없다면 하루 기다려보는 걸 추천합니다.",
    category: "strategy",
  },
];

const SEED_COMMENTS = [
  {
    post_title: "직관 처음 가는데 뭐 챙겨야 하나요?",
    user_id:    "user_bh",
    content:    "응원 도구는 현장에서 사도 되는데 줄이 길 수 있어요. 미리 구매해두는 게 편합니다.",
  },
  {
    post_title: "직관 처음 가는데 뭐 챙겨야 하나요?",
    user_id:    "viewer",
    content:    "음식 반입은 구장마다 다른데 잠실은 외부 음식 반입이 어느 정도 됩니다.",
  },
  {
    post_title: "개막 이후 카드 시세 흐름 패턴 정리",
    user_id:    "user_tm",
    content:    "정리 감사해요. 저도 비슷한 흐름 느꼈는데 이렇게 정리해주시니 이해가 쉽네요.",
  },
];

// ─── 테스트 계정 (서버 재시작마다 동일하게 복구) ──────────
const TEST_USER = {
  user_id:       'test_user',
  nickname:      '테스트유저',
  email:         process.env.TEST_USER_EMAIL || 'test@basechain.dev',
  password:      process.env.TEST_USER_PASSWORD || 'test1234',
  wallet_address: process.env.TEST_USER_WALLET || '0x15f7cc396e4C66296cE92225830e24f491941Fc2',
};

// 관리자 계정은 소스에 비밀번호를 박아두지 않는다.
// 이 저장소는 공개되기 때문에, 하드코딩된 비밀번호는 곧 운영 서버 관리자 권한을 공개하는 것과 같다.
// 비밀번호 환경변수가 없으면 계정을 아예 만들지 않는다 (알려진 비밀번호로 만드느니 없는 편이 낫다).
const DEMO_ADMIN_USER = {
  user_id:  'admin_user',
  nickname: '시연 관리자',
  email:    process.env.DEMO_ADMIN_EMAIL || 'admin@basechain.dev',
  password: process.env.DEMO_ADMIN_PASSWORD || null,
};

const ROOT_ADMIN_USER = {
  user_id:  'root_user',
  nickname: '입장관리자',
  email:    process.env.ROOT_ADMIN_EMAIL || 'root@basechain.dev',
  password: process.env.ROOT_ADMIN_PASSWORD || null,
};

/**
 * 관리자 계정을 시드한다. 비밀번호가 설정돼 있지 않으면 건너뛴다.
 * @returns {Promise<boolean>} 실제로 시드했는지 여부
 */
async function seedAdminUser(conn, admin) {
  if (!admin.password) {
    console.warn(
      `[seed] ${admin.user_id} 관리자 비밀번호 환경변수가 없어 계정 생성을 건너뜁니다. ` +
      `필요하면 server/.env 에 ${admin.user_id === 'admin_user' ? 'DEMO_ADMIN_PASSWORD' : 'ROOT_ADMIN_PASSWORD'} 를 설정하세요.`
    );
    return false;
  }
  const passwordHash = await bcrypt.hash(admin.password, 10);
  await conn.query(
    `INSERT INTO users (user_id, nickname, email, password_hash, login_type, role, is_active)
     VALUES (?, ?, ?, ?, 'local', 'admin', 1)
     ON DUPLICATE KEY UPDATE
       nickname = VALUES(nickname),
       password_hash = VALUES(password_hash),
       login_type = 'local',
       role = 'admin',
       is_active = 1`,
    [admin.user_id, admin.nickname, admin.email, passwordHash]
  );
  // 비밀번호는 로그에 남기지 않는다.
  console.log(`✅ 관리자 계정 준비 완료: ${admin.email}`);
  return true;
}

// 비밀번호 재설정 토큰. 토큰 원문은 저장하지 않고 SHA-256 해시만 보관한다.
// DB가 통째로 유출돼도 저장된 값으로는 남의 비밀번호를 바꿀 수 없게 하기 위함이다.
const PASSWORD_RESET_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id         CHAR(36)     PRIMARY KEY,
    user_id    VARCHAR(50)  NOT NULL,
    token_hash CHAR(64)     NOT NULL,
    expires_at DATETIME     NOT NULL,
    used_at    DATETIME     DEFAULT NULL,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_password_reset_token (token_hash),
    KEY idx_password_reset_user (user_id)
  )
`;

const PRACTICE_ADMIN_USER_ID = 'practice_admin';
const ADMIN_USER_IDS = [DEMO_ADMIN_USER.user_id, ROOT_ADMIN_USER.user_id, PRACTICE_ADMIN_USER_ID];

const SEED_STADIUMS = [
  { id: "jamsil",   name: "잠실야구장",              location: "서울특별시 송파구",    capacity: 25000 },
  { id: "sajik",    name: "사직야구장",              location: "부산광역시 동래구",    capacity: 24000 },
  { id: "munhak",   name: "인천SSG랜더스필드",       location: "인천광역시 미추홀구",  capacity: 23000 },
  { id: "gochuck",  name: "고척스카이돔",            location: "서울특별시 구로구",    capacity: 16744 },
  { id: "gwangju",  name: "광주-기아 챔피언스 필드", location: "광주광역시 북구",      capacity: 20000 },
  { id: "daejeon",  name: "한화생명 이글스파크",     location: "대전광역시 중구",      capacity: 13000 },
  { id: "daegu",    name: "삼성 라이온즈파크",       location: "대구광역시 수성구",    capacity: 24000 },
  { id: "changwon", name: "창원NC파크",              location: "경상남도 창원시 마산", capacity: 22000 },
  { id: "suwon",    name: "수원KT위즈파크",          location: "경기도 수원시 장안구", capacity: 20000 },
];

const SEED_GAMES = [
  // ── 5월 초 (과거 경기, 이미 종료) ──────────────────────────
  { id: "G001", home_team: "두산", away_team: "LG",   game_date: "2026-05-02", game_time: "18:30:00", stadium_id: "jamsil",  status: "SOLDOUT",  base_price: 13000 },
  { id: "G002", home_team: "KIA",  away_team: "삼성",  game_date: "2026-05-03", game_time: "14:00:00", stadium_id: "gwangju", status: "SOLDOUT",  base_price: 13000 },
  { id: "G003", home_team: "롯데", away_team: "NC",   game_date: "2026-05-04", game_time: "14:00:00", stadium_id: "sajik",   status: "SOLDOUT",  base_price: 13000 },
  { id: "G004", home_team: "한화", away_team: "SSG",  game_date: "2026-05-06", game_time: "18:30:00", stadium_id: "daejeon", status: "SOLDOUT",  base_price: 13000 },
  { id: "G005", home_team: "키움", away_team: "KT",   game_date: "2026-05-07", game_time: "18:30:00", stadium_id: "gochuck", status: "SOLDOUT",  base_price: 13000 },
  { id: "G006", home_team: "LG",   away_team: "두산",  game_date: "2026-05-09", game_time: "18:30:00", stadium_id: "jamsil",  status: "SOLDOUT",  base_price: 13000 },
  { id: "G007", home_team: "삼성", away_team: "롯데",  game_date: "2026-05-10", game_time: "14:00:00", stadium_id: "daegu",   status: "SOLDOUT",  base_price: 13000 },
  { id: "G008", home_team: "NC",   away_team: "KIA",   game_date: "2026-05-13", game_time: "18:30:00", stadium_id: "changwon",status: "SOLDOUT",  base_price: 13000 },
  { id: "G009", home_team: "SSG",  away_team: "한화",  game_date: "2026-05-14", game_time: "18:30:00", stadium_id: "munhak",  status: "SOLDOUT",  base_price: 13000 },
  { id: "G010", home_team: "두산", away_team: "KT",   game_date: "2026-05-15", game_time: "14:00:00", stadium_id: "jamsil",  status: "SOLDOUT",  base_price: 13000 },
  { id: "G011", home_team: "LG",   away_team: "키움",  game_date: "2026-05-16", game_time: "14:00:00", stadium_id: "jamsil",  status: "SOLDOUT",  base_price: 13000 },
  { id: "G012", home_team: "KIA",  away_team: "NC",   game_date: "2026-05-17", game_time: "14:00:00", stadium_id: "gwangju", status: "ALMOST",   base_price: 13000 },
  // ── 5월 18~19일 (오늘 / 내일 — QR·환불 테스트용) ──────────
  { id: "G013", home_team: "두산", away_team: "한화",  game_date: "2026-05-18", game_time: "14:00:00", stadium_id: "jamsil",  status: "OPEN",     base_price: 13000 },
  { id: "G014", home_team: "LG",   away_team: "삼성",  game_date: "2026-05-18", game_time: "18:30:00", stadium_id: "jamsil",  status: "OPEN",     base_price: 13000 },
  { id: "G015", home_team: "KIA",  away_team: "SSG",  game_date: "2026-05-18", game_time: "18:30:00", stadium_id: "gwangju", status: "OPEN",     base_price: 13000 },
  { id: "G016", home_team: "롯데", away_team: "KT",   game_date: "2026-05-19", game_time: "18:30:00", stadium_id: "sajik",   status: "OPEN",     base_price: 13000 },
  { id: "G017", home_team: "키움", away_team: "NC",   game_date: "2026-05-19", game_time: "18:30:00", stadium_id: "gochuck", status: "OPEN",     base_price: 13000 },
  // ── 5월 20일~말 (예매 가능 / UPCOMING) ─────────────────────
  { id: "G018", home_team: "한화", away_team: "두산",  game_date: "2026-05-20", game_time: "18:30:00", stadium_id: "daejeon", status: "OPEN",     base_price: 13000 },
  { id: "G019", home_team: "삼성", away_team: "LG",   game_date: "2026-05-21", game_time: "18:30:00", stadium_id: "daegu",   status: "OPEN",     base_price: 13000 },
  { id: "G020", home_team: "SSG",  away_team: "KIA",   game_date: "2026-05-22", game_time: "18:30:00", stadium_id: "munhak",  status: "OPEN",     base_price: 13000 },
  { id: "G021", home_team: "두산", away_team: "NC",   game_date: "2026-05-23", game_time: "14:00:00", stadium_id: "jamsil",  status: "OPEN",     base_price: 13000 },
  { id: "G022", home_team: "KIA",  away_team: "롯데",  game_date: "2026-05-24", game_time: "14:00:00", stadium_id: "gwangju", status: "ALMOST",   base_price: 13000 },
  { id: "G023", home_team: "LG",   away_team: "한화",  game_date: "2026-05-25", game_time: "14:00:00", stadium_id: "jamsil",  status: "UPCOMING", base_price: 13000 },
  { id: "G024", home_team: "KT",   away_team: "키움",  game_date: "2026-05-27", game_time: "18:30:00", stadium_id: "suwon",   status: "UPCOMING", base_price: 13000 },
  { id: "G025", home_team: "NC",   away_team: "SSG",  game_date: "2026-05-28", game_time: "18:30:00", stadium_id: "changwon",status: "UPCOMING", base_price: 13000 },
  { id: "G026", home_team: "롯데", away_team: "삼성",  game_date: "2026-05-29", game_time: "18:30:00", stadium_id: "sajik",   status: "UPCOMING", base_price: 13000 },
  { id: "G027", home_team: "두산", away_team: "KIA",  game_date: "2026-05-30", game_time: "14:00:00", stadium_id: "jamsil",  status: "UPCOMING", base_price: 13000 },
  { id: "G028", home_team: "한화", away_team: "LG",   game_date: "2026-05-31", game_time: "14:00:00", stadium_id: "daejeon", status: "UPCOMING", base_price: 13000 },
];

function dateTimeDaysBefore(dateStr, days, timeStr) {
  const date = new Date(`${dateStr}T00:00:00+09:00`);
  date.setDate(date.getDate() - days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d} ${timeStr}`;
}

function bookingOpenAtForGame(game) {
  if (game.status === 'UPCOMING') return dateTimeDaysBefore(game.game_date, 2, '10:00:00');
  return '2020-01-01 00:00:00';
}

function raffleOpenAtForGame(game) {
  if (game.status === 'UPCOMING') return dateTimeDaysBefore(game.game_date, 2, '08:00:00');
  return '2020-01-01 00:00:00';
}

// ─── 초기화 함수 ──────────────────────────────────────────

const GOODS_SEED = [
  ['kt-sign-ball', 1, 1, 'kt-goods', 'KT', 'KT 위즈 사인볼 파편', 'KT 위즈 공인구 사인볼 카드', '/goods/kt-sign-ball.png', 'KT 위즈 선수단의 공식 공인구 사인볼 완성 카드', '위즈 파크의 열기를 담은 공인구 사인볼 조각', 'HOT', '#c8102e', '#ff6b6b', 88, 14, 6, '위즈 파크 현장 직관 팬들 사이에서 빠르게 수요가 붙는 파편입니다.', [15200, 16400, 17800, 18500, 17900, 19200, 20500]],
  ['nc-sticker', 2, 2, 'nc-goods', 'NC', 'NC 다이노스 스티커 파편', 'NC 다이노스 시즌 스티커 컬렉션 카드', '/goods/nc-sticker.png', 'NC 다이노스 팬만을 위한 시즌 한정 스티커 컬렉션', '창원 NC파크 한정 시즌 스티커 조각', 'RISING', '#0033a0', '#7ec8ff', 74, 14, 6, '창원 원정 팬들이 가장 많이 찾는 시즌 한정 파편입니다.', [11200, 11800, 12300, 12100, 13000, 13400, 14200]],
  ['ssg-goods', 3, 3, 'ssg-goods', 'SSG', 'SSG 랜더스 개막 굿즈 파편', 'SSG 랜더스 개막 굿즈 카드', '/goods/ssg.png', 'SSG 랜더스 개막 시즌 공식 굿즈 완성 카드', '문학구장 개막 시리즈 기념 굿즈 조각', 'LIVE', '#ce1141', '#ff9d3b', 65, 14, 6, '개막 시즌 문학구장 기념 굿즈 파편으로 꾸준히 거래됩니다.', [8800, 9100, 9400, 9200, 9700, 10100, 10600]],
  ['kia-sign-ball', 4, 4, 'kia-goods', 'KIA', 'KIA 나성범 사인볼 파편', 'KIA 나성범 친필 사인볼 카드', '/goods/kia-sign-ball.png', '나성범 선수의 친필 사인이 담긴 레전드 카드', '나성범 선수 친필 사인이 담긴 희귀 조각', 'HOT', '#ff5800', '#ffe100', 92, 8, 4, '나성범 선수 친필 사인이 담긴 초희귀 파편입니다.', [22000, 23500, 24800, 26200, 25700, 27400, 29800]],
  ['doosan-uniform', 5, 5, 'doosan-goods', '두산', '두산 베어스 유니폼 파편', '두산 베어스 선수단 유니폼 카드', '/goods/doosan-uniform.png', '두산 베어스 공식 레플리카 유니폼 완성 카드', '잠실의 전통을 이어가는 베어스 유니폼 조각', 'RISING', '#131230', '#7ec8ff', 79, 12, 6, '잠실 베어스 레플리카 유니폼 파편으로 수집 수요가 높습니다.', [14100, 15200, 16000, 15700, 17100, 17900, 18800]],
  ['lotte-bat', 6, 6, 'lotte-goods', '롯데', '롯데 자이언츠 야구배트 파편', '롯데 자이언츠 황금배트 카드', '/goods/lotte-bat.png', '롯데 자이언츠 시즌 황금배트 기념 완성 카드', '사직구장의 함성을 담은 황금배트 조각', 'LIVE', '#002d62', '#ff9d3b', 67, 12, 6, '사직구장 응원석의 뜨거운 배트 응원 장면을 담은 파편입니다.', [10500, 11200, 11800, 12400, 12000, 13100, 13800]],
  ['samsung-fan', 7, 7, 'samsung-goods', '삼성', '삼성 라이온즈 응원 부채 파편', '삼성 라이온즈 여름 응원 부채 카드', '/goods/samsung-fan.png', '삼성 라이온즈 여름 한정 공식 응원 부채 카드', '대구 여름 직관의 필수템, 삼성 응원 부채 조각', 'STEADY', '#074ca1', '#ffe100', 55, 14, 6, '대구 여름 직관의 필수템, 삼성 응원 부채 파편입니다.', [6800, 7100, 7300, 7500, 7200, 7700, 8200]],
  ['lg-bat', 8, 8, 'lg-goods', 'LG', 'LG 트윈스 야구배트 파편', 'LG 트윈스 레전드 기념배트 카드', '/goods/lg-bat.png', 'LG 트윈스 레전드 선수 기념 미니배트 완성 카드', '잠실의 레전드 트윈스 기념 미니배트 조각', 'RISING', '#c60c30', '#8d7cf6', 81, 10, 5, '잠실 레전드 트윈스의 기념 미니배트 파편입니다.', [16800, 17500, 18200, 19000, 18600, 20100, 21400]],
  ['kiwoom-uniform', 9, 9, 'kiwoom-goods', '키움', '키움 히어로즈 유니폼 파편', '키움 히어로즈 홈 유니폼 카드', '/goods/kiwoom-uniform.png', '키움 히어로즈 홈 공식 유니폼 완성 카드', '고척돔을 가득 채운 히어로즈 유니폼 조각', 'STEADY', '#570514', '#ff9d3b', 58, 10, 6, '고척돔 히어로즈 홈 유니폼 파편으로 꾸준한 거래를 보입니다.', [7900, 8200, 8500, 8300, 8800, 9200, 9700]],
  ['hanwha-sticker', 10, 10, 'hanwha-goods', '한화', '한화 이글스 포토 스티커 파편', '한화 이글스 팬 포토 스티커 카드', '/goods/hanwha-sticker.png', '한화 이글스 팬 한정 포토 스티커 컬렉션 카드', '대전 이글스파크 팬 한정 포토 스티커 조각', 'STEADY', '#ff6600', '#ffe100', 51, 12, 5, '대전 이글스파크 팬 전용 포토 스티커 파편입니다.', [5500, 5800, 6000, 6200, 6100, 6500, 7000]],
];

async function seedGoodsMarketData(conn) {
  await conn.query(`DELETE FROM price_history`);
  await conn.query(`DELETE FROM market_listings`);
  await conn.query(`DELETE FROM market_assets`);
  await conn.query(`DELETE FROM box_reward_pool`);
  await conn.query(`DELETE FROM combine_recipes`);
  await conn.query(`DELETE FROM fragment_types`);
  await conn.query(`DELETE FROM card_types`);

  for (const item of GOODS_SEED) {
    const [fragmentId, cardId, onchainId, family, team, fragmentName, cardName, image, cardNote, fragmentNote, tier, color, accent, demandScore, fragmentWeight, goodsWeight, marketDescription, prices] = item;
    await conn.query(`INSERT INTO card_types (id, team, name, image_url, note) VALUES (?, ?, ?, ?, ?)`, [cardId, team, cardName, image, cardNote]);
    await conn.query(
      `INSERT INTO fragment_types (id, onchain_id, family, team, name, result_name, image_url, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [fragmentId, onchainId, family, team, fragmentName, cardName, image, fragmentNote]
    );
    await conn.query(`INSERT INTO combine_recipes (fragment_type_id, result_card_type_id, required_count) VALUES (?, ?, 2)`, [fragmentId, cardId]);
    await conn.query(
      `INSERT INTO box_reward_pool (type, fragment_type_id, card_type_id, weight, name, image_url, description) VALUES ('fragment', ?, NULL, ?, ?, ?, ?)`,
      [fragmentId, fragmentWeight, fragmentName, image, `${fragmentName} 1개를 획득했습니다.`]
    );
    await conn.query(
      `INSERT INTO box_reward_pool (type, fragment_type_id, card_type_id, weight, name, image_url, description) VALUES ('goods', NULL, ?, ?, ?, ?, ?)`,
      [cardId, goodsWeight, cardName, image, `${cardName} 원본 굿즈 NFT를 획득했습니다!`]
    );
    await conn.query(
      `INSERT INTO market_assets (id, fragment_type_id, idol, asset_name, tier, color, accent, demand_score, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [fragmentId, fragmentId, team, fragmentName, tier, color, accent, demandScore, marketDescription]
    );
    await conn.query(
      `INSERT INTO market_listings
         (id, seller_id, seller_wallet_address, fragment_type_id, price, quantity, listing_message, listing_signature)
       VALUES (UUID(), 'user_bh', NULL, ?, ?, 1, 'seed market listing', 'seed')`,
      [fragmentId, prices[prices.length - 1]]
    );
    for (const [index, price] of prices.entries()) {
      const daysAgo = prices.length - 1 - index;
      const recordedDate = daysAgo === 0 ? 'CURDATE()' : `DATE_SUB(CURDATE(), INTERVAL ${daysAgo} DAY)`;
      await conn.query(`INSERT INTO price_history (fragment_type_id, price, recorded_date) VALUES (?, ?, ${recordedDate})`, [fragmentId, price]);
    }
  }
}

async function initDB() {
  const conn = await mysql.createConnection(DB_CONFIG);
  const initLockName = `${DB_NAME}:init`;
  const [[lockRow]] = await conn.query(`SELECT GET_LOCK(?, 30) AS acquired`, [initLockName]);
  if (Number(lockRow?.acquired) !== 1) {
    await conn.end();
    throw new Error('DB 초기화 락 획득 실패');
  }

  try {
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
  );
  await conn.query(`USE \`${DB_NAME}\``);

  const resetOnStart = String(process.env.RESET_DB_ON_START || '').trim().toLowerCase() === 'true';
  const [existingUsersTable] = await conn.query(`SHOW TABLES LIKE 'users'`);
  if (!resetOnStart && existingUsersTable.length > 0) {
    await ensureRuntimeMigrations(conn);
    console.log('ℹ️ 기존 DB 유지 모드: 재시작 시 데이터를 보존합니다.');
    return;
  }

  // ─── RESET_DB_ON_START=true 또는 최초 실행 시 초기화: FK 역순으로 DROP ───────────
  await conn.query(`SET FOREIGN_KEY_CHECKS = 0`);
  // raffle / reservation 테이블
  await conn.query(`DROP TABLE IF EXISTS game_raffle_entries`);
  await conn.query(`DROP TABLE IF EXISTS reservations`);
  await conn.query(`DROP TABLE IF EXISTS draws`);
  await conn.query(`DROP TABLE IF EXISTS raffle_nfts`);
  await conn.query(`DROP TABLE IF EXISTS membership_monthly_raffle_claims`);
  await conn.query(`DROP TABLE IF EXISTS membership_tier_rewards`);
  await conn.query(`DROP TABLE IF EXISTS notification_events`);
  await conn.query(`DROP TABLE IF EXISTS point_events`);
  // combine/market 테이블 (FK 역순)
  await conn.query(`DROP TABLE IF EXISTS box_open_logs`);
  await conn.query(`DROP TABLE IF EXISTS combine_logs`);
  await conn.query(`DROP TABLE IF EXISTS purchase_history`);
  await conn.query(`DROP TABLE IF EXISTS price_history`);
  await conn.query(`DROP TABLE IF EXISTS trades`);
  await conn.query(`DROP TABLE IF EXISTS market_listings`);
  await conn.query(`DROP TABLE IF EXISTS market_assets`);
  await conn.query(`DROP TABLE IF EXISTS onchain_tx_logs`);
  await conn.query(`DROP TABLE IF EXISTS nft_tokens`);
  await conn.query(`DROP TABLE IF EXISTS user_boxes`);
  await conn.query(`DROP TABLE IF EXISTS physical_redemption_requests`);
  await conn.query(`DROP TABLE IF EXISTS user_cards`);
  await conn.query(`DROP TABLE IF EXISTS user_fragments`);
  await conn.query(`DROP TABLE IF EXISTS box_reward_pool`);
  await conn.query(`DROP TABLE IF EXISTS combine_recipes`);
  await conn.query(`DROP TABLE IF EXISTS card_types`);
  await conn.query(`DROP TABLE IF EXISTS fragment_types`);
  // fabric 이벤트 로그 테이블
  await conn.query(`DROP TABLE IF EXISTS fabric_events`);
  // refunds 테이블
  await conn.query(`DROP TABLE IF EXISTS refunds`);
  // ticket resale 테이블
  await conn.query(`DROP TABLE IF EXISTS ticket_trades`);
  await conn.query(`DROP TABLE IF EXISTS ticket_listings`);
  // 기존 테이블
  await conn.query(`DROP TABLE IF EXISTS tickets`);
  await conn.query(`DROP TABLE IF EXISTS did_verifications`);
  await conn.query(`DROP TABLE IF EXISTS user_wallets`);
  await conn.query(`DROP TABLE IF EXISTS post_likes`);
  await conn.query(`DROP TABLE IF EXISTS comments`);
  await conn.query(`DROP TABLE IF EXISTS posts`);
  await conn.query(`DROP TABLE IF EXISTS games`);
  await conn.query(`DROP TABLE IF EXISTS stadiums`);
  await conn.query(`DROP TABLE IF EXISTS notices`);
  await conn.query(`DROP TABLE IF EXISTS users`);
  await conn.query(`SET FOREIGN_KEY_CHECKS = 1`);

  // ─── 테이블 생성 ──────────────────────────────────────

  await conn.query(`
    CREATE TABLE users (
      user_id       VARCHAR(50)  PRIMARY KEY,
      nickname      VARCHAR(50)  NOT NULL,
      email         VARCHAR(255) UNIQUE DEFAULT NULL,
      password_hash VARCHAR(255) DEFAULT NULL,
      login_type    ENUM('local','google') NOT NULL DEFAULT 'local',
      google_id     VARCHAR(255) UNIQUE DEFAULT NULL,
      profile_image VARCHAR(255) DEFAULT NULL,
      role          ENUM('user','admin') NOT NULL DEFAULT 'user',
      membership_tier ENUM('베이직','브론즈','실버','골드') DEFAULT NULL,
      membership_joined_at DATETIME DEFAULT NULL,
      is_active     TINYINT(1)   NOT NULL DEFAULT 1,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await conn.query(PASSWORD_RESET_TABLE_SQL);

  await conn.query(`
    CREATE TABLE posts (
      post_id    INT          PRIMARY KEY AUTO_INCREMENT,
      user_id    VARCHAR(50)  NOT NULL,
      title      VARCHAR(255) NOT NULL,
      excerpt    TEXT,
      content    TEXT         NOT NULL,
      category   ENUM('ticket','fragment','baseball','strategy') NOT NULL,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      view_count INT          NOT NULL DEFAULT 0,
      like_count INT          NOT NULL DEFAULT 0,
      hidden     BOOLEAN      NOT NULL DEFAULT FALSE,
      deleted    BOOLEAN      NOT NULL DEFAULT FALSE,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  await conn.query(`
    CREATE TABLE comments (
      comment_id INT          PRIMARY KEY AUTO_INCREMENT,
      post_id    INT          NOT NULL,
      user_id    VARCHAR(50)  NOT NULL,
      content    TEXT         NOT NULL,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      parent_id  INT          DEFAULT NULL,
      hidden     BOOLEAN      NOT NULL DEFAULT FALSE,
      deleted    BOOLEAN      NOT NULL DEFAULT FALSE,
      FOREIGN KEY (post_id)   REFERENCES posts(post_id),
      FOREIGN KEY (user_id)   REFERENCES users(user_id),
      FOREIGN KEY (parent_id) REFERENCES comments(comment_id)
    )
  `);

  await conn.query(`
    CREATE TABLE post_likes (
      user_id    VARCHAR(50)  NOT NULL,
      post_id    INT          NOT NULL,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (post_id) REFERENCES posts(post_id)
    )
  `);

  await conn.query(`
    CREATE TABLE user_wallets (
      wallet_id      INT          PRIMARY KEY AUTO_INCREMENT,
      user_id        VARCHAR(50)  NOT NULL,
      wallet_address VARCHAR(42)  NOT NULL,
      nonce          VARCHAR(100) DEFAULT NULL,
      is_verified    BOOLEAN      NOT NULL DEFAULT FALSE,
      connected_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verified_at    DATETIME     DEFAULT NULL,
      UNIQUE KEY uq_user_wallet (user_id),
      UNIQUE KEY uq_wallet_addr (wallet_address),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE did_verifications (
      did_id         INT          PRIMARY KEY AUTO_INCREMENT,
      user_id        VARCHAR(50)  NOT NULL,
      did_value      VARCHAR(255) NOT NULL,
      wallet_address VARCHAR(42)  NOT NULL,
      last_signature TEXT         DEFAULT NULL,
      status         ENUM('pending','verified','revoked') NOT NULL DEFAULT 'pending',
      verified_at    DATETIME     DEFAULT NULL,
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_did (user_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE stadiums (
      id       VARCHAR(50)  PRIMARY KEY,
      name     VARCHAR(100) NOT NULL,
      location VARCHAR(200),
      capacity INT
    )
  `);

  await conn.query(`
    CREATE TABLE games (
      id         VARCHAR(50)  PRIMARY KEY,
      home_team  VARCHAR(50)  NOT NULL,
      away_team  VARCHAR(50)  NOT NULL,
      game_date  DATE         NOT NULL,
      game_time  TIME,
      stadium_id VARCHAR(50)  NOT NULL,
      status     ENUM('OPEN','ALMOST','SOLDOUT','UPCOMING','ENDED','CANCELLED') NOT NULL DEFAULT 'OPEN',
      base_price DECIMAL(10,2) DEFAULT NULL,
      booking_open_at DATETIME DEFAULT NULL,
      raffle_open_at DATETIME DEFAULT NULL,
      raffle_winners_count INT NOT NULL DEFAULT 5,
      FOREIGN KEY (stadium_id) REFERENCES stadiums(id)
    )
  `);

  await conn.query(`
    CREATE TABLE notices (
      id           INT           PRIMARY KEY AUTO_INCREMENT,
      title        VARCHAR(255)  NOT NULL,
      content      TEXT          NOT NULL,
      type         ENUM('공지', '이벤트', '업데이트') NOT NULL DEFAULT '공지',
      is_pinned    TINYINT(1)    DEFAULT 0,
      image_url    VARCHAR(512)  DEFAULT NULL,
      view_count   INT           DEFAULT 0,
      created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await conn.query(`
    CREATE TABLE tickets (
      id             VARCHAR(36)   PRIMARY KEY,
      wallet_address VARCHAR(100)  NOT NULL,
      game_id        VARCHAR(50)   NOT NULL,
      stadium        VARCHAR(50),
      grade          VARCHAR(50),
      block          VARCHAR(50),
      row_num        INT,
      seat_number    INT,
      price          DECIMAL(15,2),
      token_id       INT           DEFAULT NULL,
      ticket_tx_hash VARCHAR(66)   DEFAULT NULL,
      payment_key    VARCHAR(200)  DEFAULT NULL,
      point_discount INT           NOT NULL DEFAULT 0,
      purchase_type  ENUM('PRIMARY','TRANSFERRED') NOT NULL DEFAULT 'PRIMARY',
      status         ENUM('confirmed','used','listed','sold','refund_processing','refund_rejected','refunded','cancelled') NOT NULL DEFAULT 'confirmed',
      booked_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      -- 좌석 점유 잠금 키.
      -- 유효한 티켓일 때만 값이 생기고, 환불·취소되면 NULL이 되어 좌석이 다시 풀린다.
      -- UNIQUE 인덱스는 NULL을 중복으로 보지 않으므로 "살아있는 티켓만 1좌석 1장"이 DB에서 강제된다.
      seat_lock      VARCHAR(180) GENERATED ALWAYS AS (
        CASE
          WHEN status IN ('refunded','cancelled') THEN NULL
          WHEN block IS NULL OR row_num IS NULL OR seat_number IS NULL THEN NULL
          ELSE CONCAT(game_id, '|', block, '|', row_num, '|', seat_number)
        END
      ) STORED,
      UNIQUE KEY uq_ticket_active_seat (seat_lock),
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  // ─── Fabric 이벤트 로그 테이블 ───────────────────────────
  await conn.query(`
    CREATE TABLE fabric_events (
      id           CHAR(36)     PRIMARY KEY,
      event_name   VARCHAR(60)  NOT NULL,
      ticket_id    VARCHAR(36)  DEFAULT NULL,
      game_id      VARCHAR(50)  DEFAULT NULL,
      user_did_hash VARCHAR(64) DEFAULT NULL,
      payload_json JSON         DEFAULT NULL,
      fabric_tx_id VARCHAR(100) DEFAULT NULL,
      created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await conn.query(`
    CREATE TABLE point_events (
      id             CHAR(36)     PRIMARY KEY,
      user_id        VARCHAR(50)  NOT NULL,
      wallet_address VARCHAR(100) DEFAULT NULL,
      event_type     VARCHAR(50)  NOT NULL,
      reason         VARCHAR(120) NOT NULL,
      amount         INT          NOT NULL DEFAULT 0,
      metadata_json  JSON         DEFAULT NULL,
      read_at        DATETIME     DEFAULT NULL,
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE notification_events (
      id             CHAR(36)     PRIMARY KEY,
      user_id        VARCHAR(50)  NOT NULL,
      category       VARCHAR(20)  NOT NULL,
      title          VARCHAR(120) NOT NULL,
      message        VARCHAR(255) NOT NULL DEFAULT '',
      amount         INT          DEFAULT NULL,
      metadata_json  JSON         DEFAULT NULL,
      read_at        DATETIME     DEFAULT NULL,
      created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notification_user_category (user_id, category, created_at),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE membership_tier_rewards (
      id                CHAR(36)     PRIMARY KEY,
      user_id           VARCHAR(50)  NOT NULL,
      tier              ENUM('브론즈','실버','골드') NOT NULL,
      reward_cards      INT          NOT NULL DEFAULT 0,
      reward_raffles    INT          NOT NULL DEFAULT 0,
      card_payload_json JSON         DEFAULT NULL,
      raffle_nft_ids    JSON         DEFAULT NULL,
      claimed_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_membership_tier_reward (user_id, tier),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE membership_monthly_raffle_claims (
      id             CHAR(36)     PRIMARY KEY,
      user_id        VARCHAR(50)  NOT NULL,
      claim_month    CHAR(7)      NOT NULL,
      tier           ENUM('베이직','브론즈','실버','골드') NOT NULL,
      claimed_count  INT          NOT NULL DEFAULT 0,
      raffle_nft_ids JSON         DEFAULT NULL,
      expires_at     DATETIME     NOT NULL,
      claimed_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_membership_monthly_claim (user_id, claim_month),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  // ─── 환불 테이블 ─────────────────────────────────────
  await conn.query(`
    CREATE TABLE refunds (
      refund_id       CHAR(36)      PRIMARY KEY,
      ticket_id       VARCHAR(36)   NOT NULL,
      user_id         VARCHAR(50)   NOT NULL,
      purchase_type   ENUM('PRIMARY','TRANSFERRED') NOT NULL DEFAULT 'PRIMARY',
      refund_rate     DECIMAL(5,2)  NOT NULL DEFAULT 100.00,
      original_price  DECIMAL(15,2) NOT NULL,
      refund_amount   DECIMAL(15,2) NOT NULL,
      reason          VARCHAR(255)  DEFAULT NULL,
      status          ENUM('processing','completed','rejected') NOT NULL DEFAULT 'processing',
      fabric_refund_id VARCHAR(100) DEFAULT NULL,
      created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at    DATETIME      DEFAULT NULL,
      FOREIGN KEY (ticket_id) REFERENCES tickets(id),
      FOREIGN KEY (user_id)   REFERENCES users(user_id)
    )
  `);

  // ─── 응모권 NFT 테이블 ───────────────────────────────
  await conn.query(`
    CREATE TABLE raffle_nfts (
      id              CHAR(36)     PRIMARY KEY,
      user_id         VARCHAR(50)  NOT NULL,
      wallet_address  VARCHAR(100) NOT NULL,
      user_did_hash   VARCHAR(64)  NOT NULL,
      game_id         VARCHAR(50)  DEFAULT NULL,
      status          ENUM('ISSUED','ENTERED','WINNER','LOST','USED','EXPIRED') NOT NULL DEFAULT 'ISSUED',
      draw_id         CHAR(36)     DEFAULT NULL,
      fabric_token_id VARCHAR(100) DEFAULT NULL,
      source          ENUM('TIER_REWARD','MONTHLY_GRANT','POINT_EXCHANGE','ADMIN') NOT NULL DEFAULT 'POINT_EXCHANGE',
      claimed_month   CHAR(7)      DEFAULT NULL,
      expires_at      DATETIME     DEFAULT NULL,
      issued_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id)
    )
  `);

  // ─── 추첨 테이블 ──────────────────────────────────────
  await conn.query(`
    CREATE TABLE draws (
      id              CHAR(36)     PRIMARY KEY,
      game_id         VARCHAR(50)  NOT NULL,
      status          ENUM('PENDING','COMPLETED') NOT NULL DEFAULT 'PENDING',
      winner_count    INT          NOT NULL DEFAULT 10,
      total_entries   INT          NOT NULL DEFAULT 0,
      executed_at     DATETIME     DEFAULT NULL,
      created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  // ─── 예약 테이블 ──────────────────────────────────────
  await conn.query(`
    CREATE TABLE reservations (
      id                CHAR(36)     PRIMARY KEY,
      user_id           VARCHAR(50)  NOT NULL,
      wallet_address    VARCHAR(100) NOT NULL,
      game_id           VARCHAR(50)  NOT NULL,
      raffle_nft_id     CHAR(36)     DEFAULT NULL,
      priority_booking  TINYINT(1)   NOT NULL DEFAULT 0,
      ticket_id         VARCHAR(36)  DEFAULT NULL,
      status            ENUM('PENDING','CONFIRMED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'PENDING',
      fabric_record_id  VARCHAR(100) DEFAULT NULL,
      reserved_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at        DATETIME     DEFAULT NULL,
      FOREIGN KEY (user_id)  REFERENCES users(user_id),
      FOREIGN KEY (game_id)  REFERENCES games(id)
    )
  `);

  await conn.query(`
    CREATE TABLE game_raffle_entries (
      id             INT          PRIMARY KEY AUTO_INCREMENT,
      user_id        VARCHAR(50)  NOT NULL,
      game_id        VARCHAR(50)  NOT NULL,
      tickets_used   INT          NOT NULL DEFAULT 1,
      raffle_nft_ids JSON         DEFAULT NULL,
      status         ENUM('applied','won','lost','used') NOT NULL DEFAULT 'applied',
      applied_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      used_at        DATETIME     DEFAULT NULL,
      UNIQUE KEY uq_game_raffle_user (user_id, game_id),
      FOREIGN KEY (user_id) REFERENCES users(user_id),
      FOREIGN KEY (game_id) REFERENCES games(id)
    )
  `);

  // ─── 티켓 2차 거래 테이블 ─────────────────────────────

  await conn.query(`
    CREATE TABLE ticket_listings (
      id                    CHAR(36)     PRIMARY KEY,
      seller_id             VARCHAR(50)  NOT NULL,
      ticket_id             VARCHAR(36)  DEFAULT NULL,
      nft_token_id          INT          DEFAULT NULL,
      price_wei             VARCHAR(40)  DEFAULT NULL,
      list_tx_hash          VARCHAR(66)  DEFAULT NULL,
      seller_wallet_address VARCHAR(42)  DEFAULT NULL,
      list_signature        TEXT         DEFAULT NULL,
      list_message          TEXT         DEFAULT NULL,
      game_date             DATE         NOT NULL,
      home_team             VARCHAR(20)  NOT NULL,
      away_team             VARCHAR(20)  NOT NULL,
      seat_section          VARCHAR(50)  NOT NULL,
      original_price        INT          NOT NULL,
      listed_price          INT          NOT NULL,
      status                VARCHAR(20)  NOT NULL DEFAULT 'active',
      created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES users(user_id)
    )
  `);

  await conn.query(`
    CREATE TABLE ticket_trades (
      id                CHAR(36)    PRIMARY KEY,
      listing_id        CHAR(36)    NOT NULL,
      buyer_id          VARCHAR(50) NOT NULL,
      seller_id         VARCHAR(50) NOT NULL,
      price             INT         NOT NULL,
      platform_fee      INT         NOT NULL DEFAULT 0,
      settlement_amount INT         NOT NULL DEFAULT 0,
      buy_tx_hash       VARCHAR(66) DEFAULT NULL,
      traded_at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (listing_id) REFERENCES ticket_listings(id),
      FOREIGN KEY (buyer_id)   REFERENCES users(user_id),
      FOREIGN KEY (seller_id)  REFERENCES users(user_id)
    )
  `);

  // ─── combine/market 테이블 생성 ──────────────────────

  await conn.query(`
    CREATE TABLE fragment_types (
      id          VARCHAR(60)  PRIMARY KEY,
      onchain_id  INT          NOT NULL UNIQUE,
      family      VARCHAR(60)  NOT NULL,
      team        VARCHAR(20)  NOT NULL,
      name        VARCHAR(100) NOT NULL,
      result_name VARCHAR(100) NOT NULL,
      image_url   TEXT         NOT NULL,
      note        TEXT         NOT NULL
    )
  `);

  await conn.query(`
    CREATE TABLE card_types (
      id        INT          PRIMARY KEY AUTO_INCREMENT,
      team      VARCHAR(20)  NOT NULL,
      name      VARCHAR(100) NOT NULL,
      image_url TEXT         NOT NULL,
      note      TEXT         NOT NULL
    )
  `);

  await conn.query(`
    CREATE TABLE combine_recipes (
      id                  INT AUTO_INCREMENT PRIMARY KEY,
      fragment_type_id    VARCHAR(60) NOT NULL UNIQUE,
      result_card_type_id INT         NOT NULL,
      required_count      INT         NOT NULL DEFAULT 2,
      FOREIGN KEY (fragment_type_id)    REFERENCES fragment_types(id),
      FOREIGN KEY (result_card_type_id) REFERENCES card_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE box_reward_pool (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      type             VARCHAR(20)  NOT NULL,
      fragment_type_id VARCHAR(60)  NULL,
      card_type_id     INT          NULL,
      weight           INT          NOT NULL DEFAULT 10,
      name             VARCHAR(100) NOT NULL,
      image_url        TEXT         NOT NULL,
      description      TEXT         NOT NULL,
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id),
      FOREIGN KEY (card_type_id)     REFERENCES card_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE user_fragments (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      user_id          VARCHAR(50)  NOT NULL,
      fragment_type_id VARCHAR(60)  NOT NULL,
      count            INT          NOT NULL DEFAULT 0,
      UNIQUE KEY uq_user_fragment (user_id, fragment_type_id),
      FOREIGN KEY (user_id)          REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE user_cards (
      id                INT AUTO_INCREMENT PRIMARY KEY,
      user_id           VARCHAR(50)  NOT NULL,
      card_type_id      INT          NOT NULL,
      nft_id            VARCHAR(30)  NOT NULL UNIQUE,
      display_team      VARCHAR(40)  NULL,
      display_name      VARCHAR(140) NULL,
      display_image_url TEXT         NULL,
      display_note      TEXT         NULL,
      source_mode       VARCHAR(20)  NULL,
      obtained_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)      REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (card_type_id) REFERENCES card_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE physical_redemption_requests (
      id              CHAR(36)     PRIMARY KEY,
      user_id         VARCHAR(50)  NOT NULL,
      user_card_id    INT          NOT NULL,
      wallet_address  VARCHAR(100) NOT NULL,
      status          ENUM('requested','shipping','completed','cancelled') NOT NULL DEFAULT 'requested',
      recipient_name  VARCHAR(80)  DEFAULT NULL,
      phone           VARCHAR(40)  DEFAULT NULL,
      address_json    JSON         DEFAULT NULL,
      requested_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_physical_redemption_card (user_card_id),
      INDEX idx_physical_redemption_user (user_id, requested_at),
      FOREIGN KEY (user_id)      REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (user_card_id) REFERENCES user_cards(id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE user_boxes (
      user_id      VARCHAR(50) PRIMARY KEY,
      season_count INT         NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE nft_tokens (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      token_id         VARCHAR(40)  NOT NULL UNIQUE,
      token_type       VARCHAR(20)  NOT NULL,
      owner_user_id    VARCHAR(50)  NOT NULL,
      owner_wallet     VARCHAR(42)  NOT NULL,
      fragment_type_id VARCHAR(60)  NULL,
      listed_listing_id CHAR(36)    NULL,
      status           VARCHAR(20)  NOT NULL DEFAULT 'owned',
      source_action    VARCHAR(30)  NOT NULL DEFAULT 'sync',
      mint_tx_hash     VARCHAR(66)  NOT NULL,
      last_tx_hash     VARCHAR(66)  NOT NULL,
      minted_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_user_id)    REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE onchain_tx_logs (
      id             CHAR(36)    PRIMARY KEY,
      user_id        VARCHAR(50) NOT NULL,
      wallet_address VARCHAR(42) NOT NULL,
      action_type    VARCHAR(30) NOT NULL,
      tx_hash        VARCHAR(66) NOT NULL UNIQUE,
      token_id       VARCHAR(40) NULL,
      payload_json   JSON        NULL,
      created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  await conn.query(`
    CREATE TABLE market_assets (
      id               VARCHAR(60)  PRIMARY KEY,
      fragment_type_id VARCHAR(60)  NULL,
      idol             VARCHAR(20)  NOT NULL,
      asset_name       VARCHAR(100) NOT NULL,
      tier             VARCHAR(20)  NOT NULL DEFAULT 'STEADY',
      color            VARCHAR(10)  NOT NULL DEFAULT '#1456a0',
      accent           VARCHAR(10)  NOT NULL DEFAULT '#7ec8ff',
      demand_score     INT          NOT NULL DEFAULT 50,
      description      TEXT         NOT NULL,
      UNIQUE KEY uq_market_asset_fragment (fragment_type_id),
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE market_listings (
      id                   CHAR(36)    PRIMARY KEY,
      seller_id            VARCHAR(50) NOT NULL,
      seller_wallet_address VARCHAR(42) NULL,
      fragment_type_id     VARCHAR(60) NOT NULL,
      price                INT         NOT NULL,
      quantity             INT         NOT NULL,
      is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
      reserved_by          VARCHAR(50) NULL,
      reserved_until       DATETIME    NULL,
      posted_at            DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      listing_message      TEXT        NULL,
      listing_signature    VARCHAR(132) NULL,
      FOREIGN KEY (seller_id)        REFERENCES users(user_id),
      FOREIGN KEY (reserved_by)      REFERENCES users(user_id),
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE trades (
      id                   INT AUTO_INCREMENT PRIMARY KEY,
      fragment_type_id     VARCHAR(60) NOT NULL,
      listing_id           CHAR(36)    NULL,
      buyer_id             VARCHAR(50) NULL,
      seller_id            VARCHAR(50) NULL,
      buyer_wallet_address VARCHAR(42) NULL,
      seller_wallet_address VARCHAR(42) NULL,
      token_id             VARCHAR(40) NULL,
      price                INT         NOT NULL,
      quantity             INT         NOT NULL DEFAULT 1,
      platform_fee         INT         NOT NULL DEFAULT 0,
      settlement_amount    INT         NOT NULL DEFAULT 0,
      tx_hash              VARCHAR(66) NULL,
      traded_at            DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id),
      FOREIGN KEY (listing_id)       REFERENCES market_listings(id),
      FOREIGN KEY (buyer_id)         REFERENCES users(user_id),
      FOREIGN KEY (seller_id)        REFERENCES users(user_id)
    )
  `);

  await conn.query(`
    CREATE TABLE price_history (
      fragment_type_id VARCHAR(60) NOT NULL,
      price            INT         NOT NULL,
      recorded_date    DATE        NOT NULL,
      PRIMARY KEY (fragment_type_id, recorded_date),
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE purchase_history (
      id                   CHAR(36)    PRIMARY KEY,
      buyer_id             VARCHAR(50) NOT NULL,
      fragment_type_id     VARCHAR(60) NOT NULL,
      listing_id           CHAR(36)    NULL,
      seller_id            VARCHAR(50) NULL,
      buyer_wallet_address VARCHAR(42) NULL,
      seller_wallet_address VARCHAR(42) NULL,
      token_id             VARCHAR(40) NULL,
      price                INT         NOT NULL,
      quantity             INT         NOT NULL DEFAULT 1,
      platform_fee         INT         NOT NULL DEFAULT 0,
      settlement_amount    INT         NOT NULL DEFAULT 0,
      tx_hash              VARCHAR(66) NULL,
      purchased_at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (buyer_id)         REFERENCES users(user_id),
      FOREIGN KEY (fragment_type_id) REFERENCES fragment_types(id),
      FOREIGN KEY (listing_id)       REFERENCES market_listings(id),
      FOREIGN KEY (seller_id)        REFERENCES users(user_id)
    )
  `);

  await conn.query(`
    CREATE TABLE combine_logs (
      id                  CHAR(36)    PRIMARY KEY,
      user_id             VARCHAR(50) NOT NULL,
      fragment_type_id_1  VARCHAR(60) NOT NULL,
      fragment_type_id_2  VARCHAR(60) NOT NULL,
      result_card_type_id INT         NULL,
      result_name         VARCHAR(100) NOT NULL,
      result_nft_id       VARCHAR(30)  NULL,
      combined_at         DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)             REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (fragment_type_id_1)  REFERENCES fragment_types(id),
      FOREIGN KEY (fragment_type_id_2)  REFERENCES fragment_types(id),
      FOREIGN KEY (result_card_type_id) REFERENCES card_types(id)
    )
  `);

  await conn.query(`
    CREATE TABLE box_open_logs (
      id                      CHAR(36)    PRIMARY KEY,
      user_id                 VARCHAR(50) NOT NULL,
      wallet_address          VARCHAR(42) NULL,
      box_token_id            VARCHAR(40) NULL,
      reward_type             VARCHAR(20) NOT NULL,
      reward_fragment_type_id VARCHAR(60) NULL,
      reward_card_type_id     INT         NULL,
      reward_name             VARCHAR(100) NOT NULL,
      reward_token_id         VARCHAR(40) NULL,
      reward_nft_id           VARCHAR(30) NULL,
      tx_hash                 VARCHAR(66) NULL,
      opened_at               DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)                 REFERENCES users(user_id) ON DELETE CASCADE,
      FOREIGN KEY (reward_fragment_type_id) REFERENCES fragment_types(id),
      FOREIGN KEY (reward_card_type_id)     REFERENCES card_types(id)
    )
  `);

  // ─── 시드 데이터 삽입 ─────────────────────────────────

  for (const user of SEED_USERS) {
    await conn.query(
      "INSERT INTO users (user_id, nickname) VALUES (?, ?)",
      [user.user_id, user.nickname]
    );
  }

  for (const post of SEED_POSTS) {
    await conn.query(
      "INSERT INTO posts (user_id, title, excerpt, content, category) VALUES (?, ?, ?, ?, ?)",
      [post.user_id, post.title, post.excerpt, post.content, post.category]
    );
  }

  for (const comment of SEED_COMMENTS) {
    const [[post]] = await conn.query(
      "SELECT post_id FROM posts WHERE title = ?",
      [comment.post_title]
    );
    if (!post) continue;
    await conn.query(
      "INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)",
      [post.post_id, comment.user_id, comment.content]
    );
  }

  for (const s of SEED_STADIUMS) {
    await conn.query(
      "INSERT INTO stadiums (id, name, location, capacity) VALUES (?, ?, ?, ?)",
      [s.id, s.name, s.location, s.capacity]
    );
  }

  for (const g of SEED_GAMES) {
    await conn.query(
      `INSERT INTO games
         (id, home_team, away_team, game_date, game_time, stadium_id, status, base_price, booking_open_at, raffle_open_at, raffle_winners_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        g.id, g.home_team, g.away_team, g.game_date, g.game_time, g.stadium_id, g.status, g.base_price,
        bookingOpenAtForGame(g), raffleOpenAtForGame(g), 5,
      ]
    );
  }
  await conn.query(
    `UPDATE games
        SET raffle_open_at = DATE_SUB(NOW(), INTERVAL 1 HOUR),
            booking_open_at = DATE_ADD(NOW(), INTERVAL 2 HOUR),
            raffle_winners_count = 5,
            status = 'UPCOMING'
      WHERE id = 'G023'`
  );

  // ─── combine/market 시드 데이터 ──────────────────────

  await conn.query(`
    INSERT INTO card_types (id, team, name, image_url, note) VALUES
    (1, '두산', '두산 홈런볼 카드',           'https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=600&q=80', '개막 시리즈 홈런 장면이 담긴 한정 카드'),
    (2, '두산', '두산 홈런볼 골드컷 카드',    'https://images.unsplash.com/photo-1584285405429-136bf988919c?w=600&q=80', '홈런 장면의 골드 프레임 컷이 담긴 완성 카드'),
    (3, 'LG',  'LG 승리 배지 카드',          'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?w=600&q=80', '연승 구간마다 발행되는 시즌형 배지 카드'),
    (4, 'LG',  'LG 끝내기 컷 카드',          'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=600&q=80', '끝내기 순간을 담은 하이라이트 카드'),
    (5, '롯데', '롯데 원정 포토카드',          'https://images.unsplash.com/photo-1508344928928-7165b67de128?w=600&q=80', '원정 직관 인증과 함께 수요가 붙는 포토카드'),
    (6, '롯데', '롯데 응원석 파노라마 카드',   'https://images.unsplash.com/photo-1529516548873-9ce57c8f155e?w=600&q=80', '응원석 전체를 담은 파노라마 완성 카드'),
    (7, 'KIA', 'KIA 응원타월 배지 카드',      'https://images.unsplash.com/photo-1567427017947-545c5f8d16ad?w=600&q=80', '굿즈형 배지로 시즌 내내 꾸준히 거래됩니다'),
    (8, 'KIA', 'KIA 레전드 응원컷 카드',      'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?w=600&q=80', '응원석 명장면이 담긴 완성 카드')
  `);

  await conn.query(`
    INSERT INTO fragment_types (id, onchain_id, family, team, name, result_name, image_url, note) VALUES
    ('bears-slugger-1', 1, 'bears-slugger', '두산', '두산 홈런볼 카드 파편',      '두산 홈런볼 카드',         'https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=400&q=80', '장터에서 가장 거래가 많은 대표 선수 카드 조각'),
    ('bears-slugger-2', 2, 'bears-slugger', '두산', '두산 홈런볼 골드컷 파편',    '두산 홈런볼 골드컷 카드',  'https://images.unsplash.com/photo-1584285405429-136bf988919c?w=400&q=80', '홈런 장면이 들어간 특별 컷 조각'),
    ('twins-badge-1',   3, 'twins-badge',   'LG',  'LG 승리 배지 파편',          'LG 승리 배지 카드',        'https://images.unsplash.com/photo-1566577134770-3d85bb3a9cc4?w=400&q=80', '연승 구간에 맞춰 수요가 붙는 배지형 조각'),
    ('twins-badge-2',   4, 'twins-badge',   'LG',  'LG 끝내기 컷 파편',          'LG 끝내기 컷 카드',        'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=400&q=80', '끝내기 순간 컷이 들어간 시즌형 조각'),
    ('giants-photo-1',  5, 'giants-photo',  '롯데', '롯데 원정 포토카드 파편',    '롯데 원정 포토카드',        'https://images.unsplash.com/photo-1529516548873-9ce57c8f155e?w=400&q=80', '원정 직관 인증에 자주 쓰이는 포토카드 조각'),
    ('giants-photo-2',  6, 'giants-photo',  '롯데', '롯데 응원석 파노라마 파편',  '롯데 응원석 파노라마 카드', 'https://images.unsplash.com/photo-1508344928928-7165b67de128?w=400&q=80', '응원석 장면이 들어간 확장 컷 조각'),
    ('tigers-towel-1',  7, 'tigers-towel',  'KIA', 'KIA 응원타월 배지 파편',     'KIA 응원타월 배지 카드',   'https://images.unsplash.com/photo-1567427017947-545c5f8d16ad?w=400&q=80', '굿즈형 배지 카드에 쓰이는 대표 파편'),
    ('tigers-towel-2',  8, 'tigers-towel',  'KIA', 'KIA 레전드 응원컷 파편',     'KIA 레전드 응원컷 카드',   'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?w=400&q=80', '응원석 장면이 들어간 시즌형 특별 파편')
  `);

  await conn.query(`
    INSERT INTO combine_recipes (fragment_type_id, result_card_type_id, required_count) VALUES
    ('bears-slugger-1', 1, 2),
    ('bears-slugger-2', 2, 2),
    ('twins-badge-1',   3, 2),
    ('twins-badge-2',   4, 2),
    ('giants-photo-1',  5, 2),
    ('giants-photo-2',  6, 2),
    ('tigers-towel-1',  7, 2),
    ('tigers-towel-2',  8, 2)
  `);

  await conn.query(`
    INSERT INTO box_reward_pool (type, fragment_type_id, card_type_id, weight, name, image_url, description) VALUES
    ('fragment', 'bears-slugger-1', NULL, 18, '두산 홈런볼 카드 파편',     'https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=400&q=80', '두산 홈런볼 카드 파편 1개를 획득했습니다.'),
    ('fragment', 'bears-slugger-2', NULL, 12, '두산 홈런볼 골드컷 파편',   'https://images.unsplash.com/photo-1584285405429-136bf988919c?w=400&q=80', '두산 홈런볼 골드컷 파편 1개를 획득했습니다.'),
    ('fragment', 'twins-badge-1',   NULL, 18, 'LG 승리 배지 파편',         'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?w=400&q=80', 'LG 승리 배지 파편 1개를 획득했습니다.'),
    ('fragment', 'twins-badge-2',   NULL, 14, 'LG 끝내기 컷 파편',         'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=400&q=80', 'LG 끝내기 컷 파편 1개를 획득했습니다.'),
    ('fragment', 'giants-photo-1',  NULL, 14, '롯데 원정 포토카드 파편',   'https://images.unsplash.com/photo-1508344928928-7165b67de128?w=400&q=80', '롯데 원정 포토카드 파편 1개를 획득했습니다.'),
    ('fragment', 'giants-photo-2',  NULL, 10, '롯데 응원석 파노라마 파편', 'https://images.unsplash.com/photo-1529516548873-9ce57c8f155e?w=400&q=80', '롯데 응원석 파노라마 파편 1개를 획득했습니다.'),
    ('fragment', 'tigers-towel-1',  NULL,  9, 'KIA 응원타월 배지 파편',   'https://images.unsplash.com/photo-1567427017947-545c5f8d16ad?w=400&q=80', 'KIA 응원타월 배지 파편 1개를 획득했습니다.'),
    ('fragment', 'tigers-towel-2',  NULL,  5, 'KIA 레전드 응원컷 파편',   'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?w=400&q=80', 'KIA 레전드 응원컷 파편 1개를 획득했습니다.'),
    ('goods',    NULL, 1, 10, '두산 홈런볼 카드',          'https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=600&q=80', '두산 홈런볼 원본 굿즈 NFT를 획득했습니다!'),
    ('goods',    NULL, 2,  5, '두산 홈런볼 골드컷 카드',   'https://images.unsplash.com/photo-1584285405429-136bf988919c?w=600&q=80', '두산 홈런볼 골드컷 원본 굿즈 NFT를 획득했습니다!'),
    ('goods',    NULL, 3, 10, 'LG 승리 배지 카드',         'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?w=600&q=80', 'LG 승리 배지 원본 굿즈 NFT를 획득했습니다!'),
    ('goods',    NULL, 4,  8, 'LG 끝내기 컷 카드',         'https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=600&q=80', 'LG 끝내기 컷 원본 굿즈 NFT를 획득했습니다!'),
    ('goods',    NULL, 5,  8, '롯데 원정 포토카드',         'https://images.unsplash.com/photo-1508344928928-7165b67de128?w=600&q=80', '롯데 원정 포토카드 원본 굿즈 NFT를 획득했습니다!'),
    ('goods',    NULL, 6,  5, '롯데 응원석 파노라마 카드',  'https://images.unsplash.com/photo-1529516548873-9ce57c8f155e?w=600&q=80', '롯데 응원석 파노라마 원본 굿즈 NFT를 획득했습니다!'),
    ('goods',    NULL, 7,  8, 'KIA 응원타월 배지 카드',     'https://images.unsplash.com/photo-1567427017947-545c5f8d16ad?w=600&q=80', 'KIA 응원타월 배지 원본 굿즈 NFT를 획득했습니다!'),
    ('goods',    NULL, 8,  3, 'KIA 레전드 응원컷 카드',     'https://images.unsplash.com/photo-1569517282132-25d22f4573e6?w=600&q=80', 'KIA 레전드 응원컷 원본 굿즈 NFT를 획득했습니다!')
  `);

  await conn.query(`
    INSERT INTO market_assets (id, fragment_type_id, idol, asset_name, tier, color, accent, demand_score, description) VALUES
    ('bears-slugger',   'bears-slugger-1', '두산', '두산 홈런볼 카드 파편',     'HOT',    '#1456a0', '#7ec8ff', 94, '개막 시리즈 이후 수요가 빠르게 붙은 대표 파편입니다.'),
    ('bears-slugger-2', 'bears-slugger-2', '두산', '두산 홈런볼 골드컷 파편',   'RISING', '#1456a0', '#7ec8ff', 72, '홈런 장면이 들어간 특별 컷 조각으로 희귀 수요가 붙습니다.'),
    ('twins-win',       'twins-badge-1',   'LG',   'LG 승리 배지 파편',         'LIVE',   '#8d7cf6', '#2dba73', 61, '연승 구간에 거래량이 붙는 배지 파편입니다.'),
    ('twins-badge-2',   'twins-badge-2',   'LG',   'LG 끝내기 컷 파편',         'STEADY', '#8d7cf6', '#2dba73', 45, '끝내기 순간 컷이 들어간 시즌형 파편입니다.'),
    ('giants-photocard','giants-photo-1',  '롯데', '롯데 원정 포토카드 파편',   'RISING', '#2dba73', '#ff9d3b', 76, '원정 직관 인증과 함께 수요가 붙는 포토카드 파편입니다.'),
    ('giants-photo-2',  'giants-photo-2',  '롯데', '롯데 응원석 파노라마 파편', 'LIVE',   '#2dba73', '#ff9d3b', 68, '응원석 장면이 들어간 확장 컷 파편입니다.'),
    ('tigers-towel',    'tigers-towel-1',  'KIA',  'KIA 응원타월 배지 파편',    'STEADY', '#ff9d3b', '#1456a0', 58, '굿즈형 배지 카드에 쓰이는 대표 파편입니다.'),
    ('tigers-towel-2',  'tigers-towel-2',  'KIA',  'KIA 레전드 응원컷 파편',    'STEADY', '#ff9d3b', '#1456a0', 47, '응원 장면이 들어간 시즌형 특별 파편입니다.')
  `);

  await conn.query(`
    INSERT INTO ticket_listings (id, seller_id, game_date, home_team, away_team, seat_section, original_price, listed_price, status) VALUES
    ('tl-seed-0000-0000-000000000001', 'user_bh',  '2026-04-15', '삼성', 'LG',  '1루 내야 지정석', 13000, 14000, 'active'),
    ('tl-seed-0000-0000-000000000002', 'user_tm',  '2026-04-19', 'LG',  'NC',  '외야 응원석',      13000, 13000, 'active'),
    ('tl-seed-0000-0000-000000000003', 'admin_01', '2026-04-22', '두산', '키움', '3루 내야 지정석', 13000, 13500, 'active'),
    ('tl-seed-0000-0000-000000000004', 'user_bh',  '2026-04-22', '두산', '키움', '외야 응원석',     13000, 12000, 'active'),
    ('tl-seed-0000-0000-000000000005', 'user_tm',  '2026-04-15', '키움', '한화', '내야 일반석',     13000, 13000, 'active')
  `);

  await conn.query(`
    INSERT INTO price_history (fragment_type_id, price, recorded_date) VALUES
    ('bears-slugger-1', 12100, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('bears-slugger-1', 13300, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('bears-slugger-1', 15100, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('bears-slugger-1', 16600, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('bears-slugger-1', 15800, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('bears-slugger-1', 17800, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('bears-slugger-1', 19400, CURDATE()),
    ('twins-badge-1',   11800, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('twins-badge-1',   11200, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('twins-badge-1',   10400, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('twins-badge-1',   10100, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('twins-badge-1',    9900, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('twins-badge-1',    9500, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('twins-badge-1',    9200, CURDATE()),
    ('giants-photo-1',   6100, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('giants-photo-1',   6400, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('giants-photo-1',   6900, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('giants-photo-1',   7200, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('giants-photo-1',   7600, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('giants-photo-1',   7800, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('giants-photo-1',   8100, CURDATE()),
    ('tigers-towel-1',   5200, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('tigers-towel-1',   5400, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('tigers-towel-1',   5500, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('tigers-towel-1',   5600, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('tigers-towel-1',   5700, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('tigers-towel-1',   5900, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('tigers-towel-1',   6100, CURDATE()),
    ('bears-slugger-2', 15000, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('bears-slugger-2', 15800, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('bears-slugger-2', 16500, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('bears-slugger-2', 17200, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('bears-slugger-2', 16800, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('bears-slugger-2', 18100, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('bears-slugger-2', 19000, CURDATE()),
    ('twins-badge-2',    8200, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('twins-badge-2',    8000, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('twins-badge-2',    7800, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('twins-badge-2',    7600, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('twins-badge-2',    7400, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('twins-badge-2',    7200, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('twins-badge-2',    7000, CURDATE()),
    ('giants-photo-2',   9000, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('giants-photo-2',   9300, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('giants-photo-2',   9600, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('giants-photo-2',   9800, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('giants-photo-2',  10100, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('giants-photo-2',  10400, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('giants-photo-2',  10700, CURDATE()),
    ('tigers-towel-2',   4800, DATE_SUB(CURDATE(), INTERVAL 6 DAY)),
    ('tigers-towel-2',   4900, DATE_SUB(CURDATE(), INTERVAL 5 DAY)),
    ('tigers-towel-2',   5000, DATE_SUB(CURDATE(), INTERVAL 4 DAY)),
    ('tigers-towel-2',   5100, DATE_SUB(CURDATE(), INTERVAL 3 DAY)),
    ('tigers-towel-2',   5200, DATE_SUB(CURDATE(), INTERVAL 2 DAY)),
    ('tigers-towel-2',   5400, DATE_SUB(CURDATE(), INTERVAL 1 DAY)),
    ('tigers-towel-2',   5600, CURDATE())
  `);

  // ─── 테스트 추첨 시드 (서버 재시작마다 복구) ─────────
  await seedGoodsMarketData(conn);

  await conn.query(`
    INSERT INTO draws (id, game_id, status, winner_count, total_entries) VALUES
    ('draw-seed-0000-0001', 'G004', 'PENDING',   5, 0),
    ('draw-seed-0000-0002', 'G007', 'PENDING',   3, 0),
    ('draw-seed-0000-0003', 'G009', 'PENDING',  10, 0)
  `);
  console.log('✅ 테스트 추첨 3건 생성 완료');

  // ─── 테스트 계정 삽입 ─────────────────────────────────
  const testPasswordHash = await bcrypt.hash(TEST_USER.password, 10);
  await conn.query(
    `INSERT INTO users (user_id, nickname, email, password_hash, login_type)
     VALUES (?, ?, ?, ?, 'local')`,
    [TEST_USER.user_id, TEST_USER.nickname, TEST_USER.email, testPasswordHash]
  );
  await conn.query(
    `UPDATE users
        SET membership_tier = '실버',
            membership_joined_at = NOW()
      WHERE user_id = ?`,
    [TEST_USER.user_id]
  );
  await conn.query(
    `INSERT INTO user_wallets (user_id, wallet_address, is_verified, verified_at)
     VALUES (?, ?, TRUE, NOW())`,
    [TEST_USER.user_id, TEST_USER.wallet_address]
  );
  await conn.query(
    `INSERT INTO user_boxes (user_id, season_count) VALUES (?, 0)`,
    [TEST_USER.user_id]
  );
  console.log(`✅ 테스트 계정 생성: ${TEST_USER.email}`); // 비밀번호는 로그에 남기지 않는다

  await seedAdminUser(conn, DEMO_ADMIN_USER);
  await seedAdminUser(conn, ROOT_ADMIN_USER);

  console.log("✅ DB 초기화 및 시드 데이터 삽입 완료");
  } finally {
    await conn.query(`SELECT RELEASE_LOCK(?)`, [initLockName]).catch(() => {});
    await conn.end();
  }
}

async function ensureRuntimeMigrations(conn) {
  const [[roleColumn]] = await conn.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`,
    [DB_NAME]
  );

  if (!roleColumn) {
    await conn.query(
      `ALTER TABLE users
         ADD COLUMN role ENUM('user','admin') NOT NULL DEFAULT 'user'
         AFTER profile_image`
    );
  }

  await seedAdminUser(conn, DEMO_ADMIN_USER);
  await seedAdminUser(conn, ROOT_ADMIN_USER);

  await conn.query(
    `UPDATE users
        SET role = 'user'
      WHERE role = 'admin' AND user_id NOT IN (?)`,
    [ADMIN_USER_IDS]
  );

  await ensureTicketSeatUniqueness(conn);
  await conn.query(PASSWORD_RESET_TABLE_SQL);
  await ensureQueryIndexes(conn);
}

// 실제로 자주 도는 쿼리에 맞춘 인덱스.
// 없으면 데이터가 쌓일수록 전체 스캔이 되는 조회들이다.
// 각 항목의 주석은 이 인덱스를 쓰는 쿼리 위치를 가리킨다.
const QUERY_INDEXES = [
  // routes/myTicket.js — 내 입장권 목록 (WHERE t.wallet_address = ?)
  { table: 'tickets', name: 'idx_tickets_wallet', columns: '(wallet_address)' },
  // routes/ticket.js — 좌석 지도 (WHERE game_id = ? AND status NOT IN (...))
  { table: 'tickets', name: 'idx_tickets_game_status', columns: '(game_id, status)' },
  // routes/ticket.js — 결제 멱등 확인 (WHERE payment_key = ? AND wallet_address = ?)
  { table: 'tickets', name: 'idx_tickets_payment_key', columns: '(payment_key)' },
  // routes/raffleRoutes.js — 응모 가능한 응모권 (WHERE user_id = ? AND status = 'ISSUED')
  { table: 'raffle_nfts', name: 'idx_raffle_user_status', columns: '(user_id, status)' },
  // mock/fabric ExecuteDraw — 추첨 대상 (WHERE draw_id = ? AND status = 'ENTERED')
  { table: 'raffle_nfts', name: 'idx_raffle_draw_status', columns: '(draw_id, status)' },
  // index.js — 게시글 목록 (WHERE deleted = FALSE ORDER BY created_at DESC)
  { table: 'posts', name: 'idx_posts_deleted_created', columns: '(deleted, created_at)' },
  // routes/notificationRoutes.js — 안 읽은 알림 (WHERE user_id = ? AND read_at IS NULL)
  { table: 'notification_events', name: 'idx_notification_user_read', columns: '(user_id, read_at)' },
  // routes/pointRoutes.js — 월별 포인트 내역 (WHERE user_id = ? ... ORDER BY created_at DESC)
  { table: 'point_events', name: 'idx_point_user_created', columns: '(user_id, created_at)' },
  // routes/ticketResale.js — 판매 중인 매물 (WHERE status = 'active')
  { table: 'ticket_listings', name: 'idx_listing_status', columns: '(status)' },
];

async function ensureQueryIndexes(conn) {
  const added = [];
  for (const { table, name, columns } of QUERY_INDEXES) {
    const [[exists]] = await conn.query(
      `SELECT 1 AS ok
         FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?
        LIMIT 1`,
      [DB_NAME, table, name],
    );
    if (exists) continue;

    try {
      await conn.query(`ALTER TABLE \`${table}\` ADD INDEX \`${name}\` ${columns}`);
      added.push(`${table}.${name}`);
    } catch (err) {
      // 테이블이 아직 없거나(신규 배포 순서 차이) 권한이 없어도 서버는 계속 떠야 한다.
      console.warn(`[migration] 인덱스 추가 건너뜀 ${table}.${name}: ${err.message}`);
    }
  }
  if (added.length > 0) {
    console.log(`[migration] 조회 인덱스 추가: ${added.join(', ')}`);
  }
}

// 이미 운영 중인 DB에 좌석 중복 방지 장치를 뒤늦게 넣기 위한 마이그레이션.
// 신규 생성 DB는 CREATE TABLE tickets 쪽에 같은 정의가 이미 들어 있다.
async function ensureTicketSeatUniqueness(conn) {
  const [[statusColumn]] = await conn.query(
    `SELECT COLUMN_TYPE AS type
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'status'`,
    [DB_NAME]
  );
  if (statusColumn && !String(statusColumn.type).includes("'cancelled'")) {
    await conn.query(
      `ALTER TABLE tickets
         MODIFY COLUMN status
         ENUM('confirmed','used','listed','sold','refund_processing','refund_rejected','refunded','cancelled')
         NOT NULL DEFAULT 'confirmed'`
    );
    console.log('[migration] tickets.status ENUM에 cancelled 추가');
  }

  const [[seatLockColumn]] = await conn.query(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'seat_lock'`,
    [DB_NAME]
  );
  if (seatLockColumn) return;

  // 제약을 걸기 전에 이미 들어가 있는 중복 좌석을 먼저 확인한다.
  // 중복이 있으면 ALTER가 실패하므로, 서버를 죽이지 않고 무엇을 손봐야 하는지 로그로 남긴다.
  const [duplicates] = await conn.query(
    `SELECT game_id, block, row_num, seat_number, COUNT(*) AS cnt
       FROM tickets
      WHERE status NOT IN ('refunded','cancelled')
        AND block IS NOT NULL AND row_num IS NOT NULL AND seat_number IS NOT NULL
      GROUP BY game_id, block, row_num, seat_number
     HAVING COUNT(*) > 1`
  );
  if (duplicates.length > 0) {
    console.error(
      `[migration] ⚠️ 좌석 중복 ${duplicates.length}건이 이미 존재해 UNIQUE 제약을 걸 수 없습니다. ` +
      '아래 좌석을 정리한 뒤 서버를 다시 시작하세요:'
    );
    for (const row of duplicates) {
      console.error(`  - game=${row.game_id} ${row.block}블록 ${row.row_num}열 ${row.seat_number}번 (${row.cnt}장)`);
    }
    return;
  }

  await conn.query(
    `ALTER TABLE tickets
       ADD COLUMN seat_lock VARCHAR(180) GENERATED ALWAYS AS (
         CASE
           WHEN status IN ('refunded','cancelled') THEN NULL
           WHEN block IS NULL OR row_num IS NULL OR seat_number IS NULL THEN NULL
           ELSE CONCAT(game_id, '|', block, '|', row_num, '|', seat_number)
         END
       ) STORED,
       ADD UNIQUE KEY uq_ticket_active_seat (seat_lock)`
  );
  console.log('[migration] tickets 좌석 중복 방지 제약(uq_ticket_active_seat) 추가 완료');
}

module.exports = { initDB, DB_NAME, DB_CONFIG };
