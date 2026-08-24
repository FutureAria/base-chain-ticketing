export type SeatTicketTypeId = "adult" | "youth" | "membership" | "kids";

export type SeatTicketType = {
  id: SeatTicketTypeId;
  label: string;
  multiplier: number;
  description: string;
};

export type SeatBlock = {
  id: string;
  label: string;
  rows: number;
  seatsPerRow: number;
  gate: string;
  note?: string;
  disabledSeats?: string[];
};

export type SeatGrade = {
  id: string;
  name: string;
  description: string;
  color: string;
  price: number;
  gate: string;
  notes?: string[];
  blocks: SeatBlock[];
};

export type TicketEvent = {
  id: string;
  name: string;
  date: string;
  dateTime: string;
  venue: string;
  stadium: string;
  city: string;
  price: number;
  status: "예매중" | "오픈예정" | "매진임박";
  statusColor: string;
  image: string;
  remaining: number;
  verificationLabel: string;
  verificationHelp: string;
  maxTickets: number;
  seatGrades: SeatGrade[];
};

export type StoredTicketRecord = {
  id: string;
  eventId: string;
  event: string;
  date: string;
  venue: string;
  seat: string;
  gate: string;
  status: "사용 가능";
  nftId: string;
  color: string;
  blockLabel: string;
  row: number;
  seatNumber: number;
  price: number;
  ticketTypeLabel: string;
  bookedAt: string;
  gradeName: string;
};

export const seatTicketTypes: SeatTicketType[] = [
  { id: "adult", label: "일반", multiplier: 1, description: "기본 일반가" },
  { id: "youth", label: "청소년", multiplier: 0.82, description: "청소년 할인" },
  { id: "membership", label: "블루 멤버십", multiplier: 0.9, description: "구단 멤버십 할인" },
  { id: "kids", label: "키즈클럽", multiplier: 0.72, description: "어린이 회원 전용" },
];

const bookingStorageKey = "base-chain-ticket-bookings-v1";

function seatKeys(rows: number[], seatStart: number, seatEnd: number) {
  return rows.flatMap((row) =>
    Array.from({ length: seatEnd - seatStart + 1 }, (_, index) => `${row}-${seatStart + index}`),
  );
}

export const ticketEvents: TicketEvent[] = [
  {
    id: "jamsil-opening",
    name: "잠실 금요 경기 · 두산 vs 롯데",
    date: "2026.05.15 (금)",
    dateTime: "2026-05-15T18:30:00+09:00",
    venue: "잠실야구장, 서울",
    stadium: "잠실야구장",
    city: "서울",
    price: 29000,
    status: "예매중",
    statusColor: "#2dba73",
    image: "https://images.unsplash.com/photo-1471295253337-3ceaaedca402?w=1200&q=80",
    remaining: 142,
    verificationLabel: "잠실 본인확인",
    verificationHelp: "예매 전 보안코드를 입력하면 좌석을 확인할 수 있습니다.",
    maxTickets: 4,
    seatGrades: [
      {
        id: "jamsil-blue",
        name: "1루 응원 블루석",
        description: "응원단과 가까운 잠실 대표 응원 구역",
        color: "#2f6fb7",
        price: 24000,
        gate: "1루 GATE 2",
        notes: ["응원가 소리가 큰 구역", "4매까지 연석 선택 가능"],
        blocks: [
          {
            id: "jamsil-blue-116",
            label: "116",
            rows: 11,
            seatsPerRow: 14,
            gate: "1루 GATE 2",
            disabledSeats: [...seatKeys([1], 1, 6), ...seatKeys([11], 12, 14)],
          },
          {
            id: "jamsil-blue-115",
            label: "115",
            rows: 11,
            seatsPerRow: 12,
            gate: "1루 GATE 2",
            note: "앞열 난간 주의",
            disabledSeats: [...seatKeys([1, 2], 1, 5), ...seatKeys([10], 10, 12)],
          },
          {
            id: "jamsil-blue-114",
            label: "114",
            rows: 10,
            seatsPerRow: 15,
            gate: "1루 GATE 2",
            note: "응원단 시야에 가까움",
            disabledSeats: [...seatKeys([1], 3, 10), ...seatKeys([9, 10], 1, 2)],
          },
          {
            id: "jamsil-blue-216",
            label: "216",
            rows: 17,
            seatsPerRow: 17,
            gate: "1루 GATE 3",
            disabledSeats: [...seatKeys([1], 12, 17), ...seatKeys([17], 1, 3)],
          },
        ],
      },
      {
        id: "jamsil-table",
        name: "중앙 테이블석",
        description: "포수 뒤쪽 시야와 식음 동선이 좋은 프리미엄 존",
        color: "#d99d4d",
        price: 29000,
        gate: "중앙 GATE 1",
        notes: ["테이블형 좌석", "구매 시 시야 우수"],
        blocks: [
          {
            id: "jamsil-table-t1",
            label: "T1",
            rows: 6,
            seatsPerRow: 8,
            gate: "중앙 GATE 1",
            disabledSeats: [...seatKeys([1], 1, 2), ...seatKeys([6], 7, 8)],
          },
          {
            id: "jamsil-table-t2",
            label: "T2",
            rows: 6,
            seatsPerRow: 8,
            gate: "중앙 GATE 1",
            disabledSeats: [...seatKeys([1], 7, 8), ...seatKeys([5], 1, 2)],
          },
        ],
      },
      {
        id: "jamsil-red",
        name: "3루 레드석",
        description: "원정 응원과 내야 시야를 함께 잡는 구역",
        color: "#d45555",
        price: 21000,
        gate: "3루 GATE 2",
        notes: ["원정 응원 비중이 높은 편", "상단 일부 시야제한 안내"],
        blocks: [
          {
            id: "jamsil-red-208",
            label: "208",
            rows: 13,
            seatsPerRow: 15,
            gate: "3루 GATE 2",
            disabledSeats: [...seatKeys([1], 1, 4), ...seatKeys([13], 13, 15)],
          },
          {
            id: "jamsil-red-209",
            label: "209",
            rows: 13,
            seatsPerRow: 15,
            gate: "3루 GATE 2",
            note: "후열 계단 접근 빠름",
            disabledSeats: [...seatKeys([2], 12, 15), ...seatKeys([12, 13], 1, 2)],
          },
        ],
      },
      {
        id: "jamsil-outfield",
        name: "외야 그린석",
        description: "가성비가 좋은 자유로운 외야 관람 구역",
        color: "#4d9d6f",
        price: 12000,
        gate: "외야 GATE A",
        notes: ["외야 펜스 가까움", "홈런볼 낙하지점"],
        blocks: [
          {
            id: "jamsil-outfield-401",
            label: "401",
            rows: 9,
            seatsPerRow: 18,
            gate: "외야 GATE A",
            disabledSeats: [...seatKeys([1], 1, 7), ...seatKeys([9], 14, 18)],
          },
          {
            id: "jamsil-outfield-402",
            label: "402",
            rows: 9,
            seatsPerRow: 18,
            gate: "외야 GATE A",
            note: "바람 영향이 큰 구역",
            disabledSeats: [...seatKeys([1, 2], 15, 18), ...seatKeys([8, 9], 1, 3)],
          },
        ],
      },
    ],
  },
  {
    id: "sajik-weekend",
    name: "대구 금요 경기 · 삼성 vs KIA",
    date: "2026.05.15 (금)",
    dateTime: "2026-05-15T18:30:00+09:00",
    venue: "대구삼성라이온즈파크, 대구",
    stadium: "대구삼성라이온즈파크",
    city: "대구",
    price: 24000,
    status: "오픈예정",
    statusColor: "#ff9d3b",
    image: "https://images.unsplash.com/photo-1508344928928-7165b67de128?w=1200&q=80",
    remaining: 0,
    verificationLabel: "사직 오픈 알림",
    verificationHelp: "예매 시작 전에는 선호 좌석과 알림만 등록할 수 있습니다.",
    maxTickets: 4,
    seatGrades: [
      {
        id: "sajik-central",
        name: "중앙 지정석",
        description: "사직 메인뷰 중심",
        color: "#2f6fb7",
        price: 24000,
        gate: "중앙 GATE 1",
        blocks: [{ id: "sajik-central-101", label: "101", rows: 10, seatsPerRow: 14, gate: "중앙 GATE 1" }],
      },
      {
        id: "sajik-outfield",
        name: "외야 지정석",
        description: "가성비 중심 좌석",
        color: "#4d9d6f",
        price: 14000,
        gate: "외야 GATE A",
        blocks: [{ id: "sajik-outfield-401", label: "401", rows: 8, seatsPerRow: 18, gate: "외야 GATE A" }],
      },
    ],
  },
  {
    id: "incheon-night",
    name: "문학 나이트 게임 · SSG vs LG",
    date: "2026.05.15 (금)",
    dateTime: "2026-05-15T18:30:00+09:00",
    venue: "인천 SSG랜더스필드",
    stadium: "SSG랜더스필드",
    city: "인천",
    price: 22000,
    status: "매진임박",
    statusColor: "#1456a0",
    image: "https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?w=1200&q=80",
    remaining: 21,
    verificationLabel: "문학 빠른 예매",
    verificationHelp: "남은 좌석이 적어 구역 선택 후 5분 안에 결제를 완료해야 합니다.",
    maxTickets: 4,
    seatGrades: [
      {
        id: "incheon-red",
        name: "랜더스 레드석",
        description: "응원단과 가까운 인기 구역",
        color: "#d45555",
        price: 22000,
        gate: "1루 GATE B",
        blocks: [{ id: "incheon-red-114", label: "114", rows: 11, seatsPerRow: 13, gate: "1루 GATE B" }],
      },
      {
        id: "incheon-navy",
        name: "내야 네이비석",
        description: "경기 보기 좋은 밸런스형 좌석",
        color: "#5f7188",
        price: 18000,
        gate: "중앙 GATE 2",
        blocks: [{ id: "incheon-navy-204", label: "204", rows: 12, seatsPerRow: 14, gate: "중앙 GATE 2" }],
      },
    ],
  },
];

export function getTicketEvent(eventId: string) {
  return ticketEvents.find((event) => event.id === eventId);
}

// stadium_id → 좌석 배치 템플릿 매핑
const STADIUM_TEMPLATE: Record<string, string> = {
  jamsil:  "jamsil-opening",
  sajik:   "sajik-weekend",
  munhak:  "incheon-night",
  gochuck: "jamsil-opening",
  gwangju: "jamsil-opening",
  daejeon: "jamsil-opening",
};

// API 게임 데이터 → TicketEvent 변환 (좌석 배치는 stadium 템플릿 재사용)
export function buildEventFromApiGame(game: {
  id: string;
  home_team: string;
  away_team: string;
  game_date: string;
  game_time: string;
  stadium_id: string;
  stadium_name: string;
  location: string;
  status: string;
  base_price: number;
}): TicketEvent | undefined {
  const templateId = STADIUM_TEMPLATE[game.stadium_id] ?? "jamsil-opening";
  const template   = ticketEvents.find((e) => e.id === templateId);
  if (!template) return undefined;

  const dateObj  = new Date(`${game.game_date}T${game.game_time ?? "18:30:00"}+09:00`);
  const dateParts = game.game_date.split("-");
  const weekdays  = ["일", "월", "화", "수", "목", "금", "토"];
  const weekday   = weekdays[dateObj.getDay()];
  const dateLabel = `${dateParts[0]}.${dateParts[1]}.${dateParts[2]} (${weekday})`;
  const statusMap: Record<string, TicketEvent["status"]> = {
    OPEN:    "예매중",
    ALMOST:  "매진임박",
    SOLDOUT: "매진임박",
    UPCOMING:"오픈예정",
  };

  return {
    ...template,
    id:       game.id,
    name:     `${game.home_team} vs ${game.away_team}`,
    date:     dateLabel,
    dateTime: dateObj.toISOString(),
    venue:    `${game.stadium_name}, ${game.location.split(" ").slice(0, 2).join(" ")}`,
    stadium:  game.stadium_name,
    status:   statusMap[game.status] ?? "예매중",
    price:    game.base_price ?? template.price,
  };
}

export function loadStoredTickets() {
  if (typeof window === "undefined") return [] as StoredTicketRecord[];

  try {
    const raw = window.localStorage.getItem(bookingStorageKey);
    if (!raw) return [];
    return JSON.parse(raw) as StoredTicketRecord[];
  } catch {
    return [];
  }
}

export function saveStoredTickets(records: StoredTicketRecord[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(bookingStorageKey, JSON.stringify(records));
}

export function getTakenSeatKeys(eventId: string) {
  const records = loadStoredTickets().filter((record) => record.eventId === eventId);
  return new Set(records.map((record) => `${record.blockLabel}:${record.row}-${record.seatNumber}`));
}

export function createStoredTickets(input: {
  event: TicketEvent;
  grade: SeatGrade;
  block: SeatBlock;
  seats: { row: number; seatNumber: number; ticketTypeId: SeatTicketTypeId }[];
}) {
  return input.seats.map((seat, index) => {
    const ticketType = seatTicketTypes.find((item) => item.id === seat.ticketTypeId) ?? seatTicketTypes[0];
    const price = Math.round(input.grade.price * ticketType.multiplier);

    return {
      id: `TKT-${Date.now().toString().slice(-6)}-${index + 1}`,
      eventId: input.event.id,
      event: input.event.name,
      date: `${input.event.date} ${new Date(input.event.dateTime).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })}`,
      venue: input.event.venue,
      seat: `${input.grade.name} ${input.block.label}블록 ${seat.row}열 ${seat.seatNumber}번`,
      gate: input.block.gate,
      status: "사용 가능" as const,
      nftId: `#GAME-${Math.floor(1000 + Math.random() * 8999)}`,
      color: input.grade.color,
      blockLabel: input.block.label,
      row: seat.row,
      seatNumber: seat.seatNumber,
      price,
      ticketTypeLabel: ticketType.label,
      bookedAt: new Date().toISOString(),
      gradeName: input.grade.name,
    };
  });
}
