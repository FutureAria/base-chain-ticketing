import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Layout } from "./components/Layout";
import { AdminOnly } from "./components/AdminOnly";
import { Home } from "./pages/Home";
import { NotFound } from "./pages/NotFound";
import { Tickets } from "./pages/Tickets";

const Login          = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const Register       = lazy(() => import("./pages/Register").then((m) => ({ default: m.Register })));
const TicketBooking        = lazy(() => import("./pages/TicketBooking").then((m) => ({ default: m.TicketBooking })));
const TicketBookingSuccess = lazy(() => import("./pages/TicketBookingSuccess").then((m) => ({ default: m.TicketBookingSuccess })));
const MyTickets      = lazy(() => import("./pages/MyTickets").then((m) => ({ default: m.MyTickets })));
const Combine        = lazy(() => import("./pages/Combine").then((m) => ({ default: m.Combine })));
const Market         = lazy(() => import("./pages/Market").then((m) => ({ default: m.Market })));
const Community      = lazy(() => import("./pages/Community").then((m) => ({ default: m.Community })));
const Notice         = lazy(() => import("./pages/Notice").then((m) => ({ default: m.Notice })));
const NoticeWrite    = lazy(() => import("./pages/NoticeWrite").then((m) => ({ default: m.NoticeWrite })));
const MyPage         = lazy(() => import("./pages/MyPage").then((m) => ({ default: m.MyPage })));
const Membership     = lazy(() => import("./pages/Membership").then((m) => ({ default: m.Membership })));
const PointHistory   = lazy(() => import("./pages/PointHistory").then((m) => ({ default: m.PointHistory })));
const TicketResale        = lazy(() => import("./pages/TicketResale").then((m) => ({ default: m.TicketResale })));
const TicketResaleSuccess = lazy(() => import("./pages/TicketResaleSuccess").then((m) => ({ default: m.TicketResaleSuccess })));
const MarketBuySuccess    = lazy(() => import("./pages/MarketBuySuccess").then((m) => ({ default: m.MarketBuySuccess })));
const Collection     = lazy(() => import("./pages/Collection").then((m) => ({ default: m.Collection })));
const Attendance     = lazy(() => import("./pages/Attendance").then((m) => ({ default: m.Attendance })));
const Exchange       = lazy(() => import("./pages/Exchange").then((m) => ({ default: m.Exchange })));
const PhysicalExchange = lazy(() => import("./pages/PhysicalExchange").then((m) => ({ default: m.PhysicalExchange })));
const EntryScanner   = lazy(() => import("./pages/EntryScanner").then((m) => ({ default: m.EntryScanner })));
const Raffle         = lazy(() => import("./pages/Raffle").then((m) => ({ default: m.Raffle })));

/**
 * 관리자 전용 화면을 감싼다.
 * 실제 권한 판단은 서버(API 401/403)가 하고, 여기서는 안내만 앞당겨 보여준다.
 */
function withAdminSuspense(Component: React.ComponentType, title: string) {
  return function AdminLazyRoute() {
    return (
      <Suspense fallback={<div className="page-shell" />}>
        <AdminOnly title={title}>
          <Component />
        </AdminOnly>
      </Suspense>
    );
  };
}

function withSuspense(Component: React.ComponentType) {
  return function LazyRoute() {
    return (
      <Suspense fallback={<div className="page-shell" />}>
        <Component />
      </Suspense>
    );
  };
}

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: withSuspense(Login),
  },
  {
    path: "/register",
    Component: withSuspense(Register),
  },
  {
    path: "/",
    Component: Layout,
    ErrorBoundary: NotFound,
    children: [
      { index: true, Component: Home },
      { path: "tickets",                  Component: withSuspense(Tickets) },
      { path: "tickets/:eventId/booking", Component: withSuspense(TicketBooking) },
      { path: "tickets/booking/success",  Component: withSuspense(TicketBookingSuccess) },
      { path: "my-tickets",               Component: withSuspense(MyTickets) },
      { path: "combine",                  Component: withSuspense(Combine) },
      { path: "market",                   Component: withSuspense(Market) },
      { path: "community",                Component: withSuspense(Community) },
      { path: "notice",                   Component: withSuspense(Notice) },
      { path: "notice/write",             Component: withAdminSuspense(NoticeWrite, "공지 작성은 관리자 전용입니다") },
      { path: "notice/write/:id",         Component: withAdminSuspense(NoticeWrite, "공지 수정은 관리자 전용입니다") },
      { path: "mypage",                   Component: withSuspense(MyPage) },
      { path: "mypage/membership",        Component: withSuspense(Membership) },
      { path: "mypage/points",            Component: withSuspense(PointHistory) },
      { path: "mypage/raffle",            Component: withSuspense(Raffle) },
      { path: "raffle",                   Component: withSuspense(Raffle) },
      { path: "ticket-resale",            Component: withSuspense(TicketResale) },
      { path: "resale",                   element: <Navigate to="/ticket-resale" replace /> },
      { path: "market/buy/success",          Component: withSuspense(TicketResaleSuccess) },
      { path: "market/fragment/buy/success", Component: withSuspense(MarketBuySuccess) },
      { path: "collection",               Component: withSuspense(Collection) },
      { path: "attendance",               Component: withSuspense(Attendance) },
      { path: "exchange",                  Component: withSuspense(Exchange) },
      { path: "physical-exchange",         Component: withSuspense(PhysicalExchange) },
      { path: "entry-scanner",             Component: withAdminSuspense(EntryScanner, "QR 검표는 관리자 전용입니다") },
    ],
  },
  {
    path: "*",
    Component: NotFound,
  },
]);
