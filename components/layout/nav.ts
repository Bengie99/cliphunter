import {
  Archive,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  Flame,
  HardDrive,
  Inbox,
  Kanban,
  LayoutDashboard,
  Plug,
  Radar,
  Settings,
  Star,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Phase in which the page becomes functional (shown as a badge until then). */
  phase?: number;
  badgeKey?: "awaitingReview";
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/analytics", label: "Analytics", icon: BarChart3, phase: 3 },
    ],
  },
  {
    title: "Clips",
    items: [
      { href: "/discover", label: "Discover Clips", icon: Radar },
      { href: "/clips", label: "All Clips", icon: Clapperboard },
      { href: "/trending", label: "Trending", icon: Flame },
      { href: "/review", label: "Review Queue", icon: Inbox, badgeKey: "awaitingReview" },
      { href: "/favorites", label: "Favorites", icon: Star },
      { href: "/approved", label: "Approved Clips", icon: CheckCircle2 },
      { href: "/archived", label: "Rejected / Archived", icon: Archive },
    ],
  },
  {
    title: "Production",
    items: [
      { href: "/footage", label: "Downloaded Footage", icon: HardDrive },
      { href: "/pipeline", label: "Content Pipeline", icon: Kanban, phase: 5 },
    ],
  },
  {
    title: "Sources",
    items: [
      { href: "/creators", label: "Streamers & Creators", icon: Users },
      { href: "/integrations", label: "Platform Integrations", icon: Plug },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];
