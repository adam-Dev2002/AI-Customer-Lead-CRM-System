import {
  ArrowDownUp,
  ArrowLeft,
  Ban,
  BarChart3,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FilePenLine,
  FileText,
  FilterX,
  Inbox,
  Loader2,
  LogIn,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Use one symbol and size for each action throughout the workspace.
const icons = {
  approve: Check,
  assistant: Sparkles,
  back: ArrowLeft,
  cancel: X,
  clearFilters: FilterX,
  copy: Copy,
  create: Plus,
  createReply: FilePenLine,
  delete: Trash2,
  download: Download,
  edit: Pencil,
  expand: ChevronDown,
  external: ExternalLink,
  help: CircleHelp,
  hide: EyeOff,
  import: Upload,
  importExport: ArrowDownUp,
  inbox: Inbox,
  loading: Loader2,
  more: MoreHorizontal,
  next: ChevronRight,
  previous: ChevronLeft,
  reject: Ban,
  report: BarChart3,
  reschedule: CalendarClock,
  reset: RotateCcw,
  retry: RefreshCw,
  review: FileText,
  save: Save,
  send: Send,
  settings: Settings,
  signIn: LogIn,
  signOut: LogOut,
  today: CalendarDays,
  view: Eye,
} as const;

export type ActionName = keyof typeof icons;

export function ActionIcon({ action, className }: { action: ActionName; className?: string }) {
  const Icon = icons[action];
  return (
    <Icon
      aria-hidden="true"
      focusable="false"
      data-action-icon={action}
      strokeWidth={2}
      className={cn("size-4 shrink-0", action === "loading" && "animate-spin motion-reduce:animate-none", className)}
    />
  );
}
