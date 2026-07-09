export type TaskStatus =
  | "未开始"
  | "待拍摄"
  | "已拍摄"
  | "待修图"
  | "待发布"
  | "已发布"
  | "已复盘";

export type ContentCategory =
  | "小院第一眼"
  | "拍照机位"
  | "主理人故事"
  | "茶饮茶点体验"
  | "工作日安静理由"
  | "斑竹林半日游攻略";

export interface ContentTask {
  day: number;
  week: number;
  rawType: string;
  category: ContentCategory;
  contentType?: string;
  theme: string;
  topic?: string;
  title: string;
  product: string;
  mainProduct?: string;
  highClickTitle?: string;
  titleDirection?: string;
  titleReason?: string;
  coverText?: string;
  altTitles?: string[];
  bodyCopy?: string;
  imagePlan?: string[];
  shootingTask: string;
  copyFocus: string;
  conversion: string;
  keywords: string[];
  tags: string[];
  seoReason?: string;
  copyReason?: string;
  operationJudge?: string;
}

export interface ProductCard {
  name: string;
  type: string;
  role: string;
  imageKeywords: string[];
  themes: string[];
  coverFit: "很适合" | "适合" | "一般";
  note: string;
  tone: string;
}

export interface ReviewData {
  publishTime?: string;
  impressions?: number;
  reads?: number;
  likes?: number;
  saves?: number;
  comments?: number;
  shares?: number;
  profileViews?: number;
  messages?: number;
  bookings?: number;
  visits?: number;
  userQuestions?: string;
  notes?: string;
}

export interface ShotCheck {
  done: boolean;
  updatedAt: string;
}

export interface TodayShootPlan {
  date: string;
  selectedDays: number[];
  updatedAt: string;
}

export interface PersistedState {
  version: number;
  startDate: string;
  statuses: Record<number, TaskStatus>;
  checks: Record<number, Record<string, boolean>>;
  shotChecks: Record<number, Record<number, ShotCheck>>;
  todayShootPlan: TodayShootPlan;
  reviews: Record<number, ReviewData>;
  manualNotes: Record<string, string>;
  currentDay: number;
  importedAt: string;
  lastSavedAt: string;
  lastBackupAt: string;
  lastCloudSavedAt: string;
  lastCloudLoadedAt: string;
  edits: {
    tasks: Record<number, Partial<ContentTask>>;
    products: Record<number, Partial<ProductCard>>;
    library: Record<number, { title?: string; html?: string }>;
  };
}
