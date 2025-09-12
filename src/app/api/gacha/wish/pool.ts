// สร้างพูลกาชาจาก /data/cards.json — ไม่มีฮาร์ดโค้ดรายชื่อการ์ด
import cardsJson from "@/data/cards.json";

type Character = {
  char_id: number;
  code: string;
  name: string;
  element: string;
  art: string;
};
type Support = { id: number; code: string; name: string; art: string };
type Event = { id: number; code: string; name: string; art: string };

type CardsData = {
  characters: Character[];
  supports: Support[];
  events: Event[];
};

export type PoolItem = {
  id: number; // char_id หรือ id (ของ supports/events)
  code: string;
  name: string;
  kind: "character" | "support" | "event";
  art: string; // ชื่อไฟล์จาก cards.json
  artUrl: string; // path สำหรับหน้าเว็บ
  rarity: 3 | 4 | 5;
  element?: string;
};

const data = cardsJson as CardsData;

// เปลี่ยนตัว “หน้าตู้” ตรงนี้ (หรือใส่ ENV NOF_FEATURED_CHAR_ID ตอน deploy)
const FEATURED_CHAR_ID = Number(process.env.NOF_FEATURED_CHAR_ID ?? 4);

// path ของรูป ให้สอดคล้องกับที่ deck-builder ใช้อยู่
const asArtUrl = (kind: PoolItem["kind"], art: string) =>
  kind === "character" ? `/char_cards/${encodeURI(art)}` : `/cards/${encodeURI(art)}`;

// 5★ ทั้งหมด = ตัวละครทั้งหมดจาก cards.json
const ALL_CHAR_5: PoolItem[] = data.characters.map((c) => ({
  id: c.char_id,
  code: c.code,
  name: c.name,
  kind: "character" as const,
  art: c.art,
  artUrl: asArtUrl("character", c.art),
  rarity: 5,
  element: c.element,
}));

// 4★ = supports + events ทั้งชุด (ถ้าต้องการแยก 3★ จริง ๆ ค่อยฟิลเตอร์ภายหลังได้)
const ALL_OTHERS: PoolItem[] = [
  ...data.supports.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    kind: "support" as const,
    art: s.art,
    artUrl: asArtUrl("support", s.art),
    rarity: 4 as const,
  })),
  ...data.events.map((e) => ({
    id: e.id,
    code: e.code,
    name: e.name,
    kind: "event" as const,
    art: e.art,
    artUrl: asArtUrl("event", e.art),
    rarity: 4 as const,
  })),
];

export const FIVE_FEATURED: PoolItem[] = ALL_CHAR_5.filter((c) => c.id === FEATURED_CHAR_ID);
export const FIVE_OFF: PoolItem[] = ALL_CHAR_5.filter((c) => c.id !== FEATURED_CHAR_ID);

// 4★ พูลหลัก
export const FOUR_POOL: PoolItem[] = ALL_OTHERS;

// 3★ (เบื้องต้นให้ใช้ชุดเดียวกับ 4★ แต่ set rarity=3)
// ถ้าอยากกำหนดชุด 3★ จริง ๆ ให้ฟิลเตอร์ id ตรงนี้เองได้
export const THREE_POOL: PoolItem[] = ALL_OTHERS.map((x) => ({ ...x, rarity: 3 as const }));

export const POOLS = {
  FIVE_FEATURED,
  FIVE_OFF,
  FOUR_POOL,
  THREE_POOL,
};
