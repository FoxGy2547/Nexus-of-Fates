export type Element =
  | "Pyro" | "Hydro" | "Cryo" | "Electro" | "Geo"
  | "Anemo" | "Quantum" | "Imaginary" | "Neutral";
export type Rarity = "N" | "R" | "SR" | "SSR";

export type Card = {
  code: string;
  name: string;
  element: Element;
  rarity: Rarity;
  atk: number;
  hp: number;
  ability: string;
  image: string;
};

export const ALL_CARDS: Card[] = [
  { code:"BLAZE_KNIGHT", name:"Blaze Knight", element:"Pyro", rarity:"SR",  atk:5, hp:4, ability:"Burn: โดนครั้งแรกติด Burn(1) 2 เทิร์น", image:"Blaze Knight.png" },
  { code:"FROST_ARCHER", name:"Frost Archer", element:"Cryo", rarity:"R",  atk:3, hp:3, ability:"Freeze Shot: ถ้าเป้าเปียก → Freeze 1 เทิร์น", image:"Frost Archer.png" },
  { code:"THUNDER_COLOSSUS", name:"Thunder Colossus", element:"Electro", rarity:"SSR", atk:6, hp:7, ability:"Chain: โดนศัตรูสุ่มอีกใบดาเมจครึ่ง", image:"Thunder Colossus.png" },
  { code:"WINDBLADE_DUELIST", name:"Windblade Duelist", element:"Anemo", rarity:"N", atk:3, hp:2, ability:"Gust: ย้ายยูนิตเป้าหมายกลับมือ (CD2)", image:"Windblade Duelist.png" },
  { code:"STONE_BULWARK", name:"Stone Bulwark", element:"Geo", rarity:"R", atk:2, hp:6, ability:"Shield: ใบถัดไปที่ลงเทิร์นนี้ได้เกราะ +2", image:"Stone Bulwark.png" },
  { code:"TIDE_MAGE", name:"Tide Mage", element:"Hydro", rarity:"R", atk:2, hp:4, ability:"Heal 2 และใส่ Soak 1 ให้ศัตรู", image:"Tide Mage.png" },
  { code:"VOID_SEER", name:"Void Seer", element:"Quantum", rarity:"SR", atk:4, hp:3, ability:"Collapse: +1 ดาเมจจากทุกแหล่งในเทิร์นนี้", image:"Void Seer.png" },
  { code:"MINDSHAPER", name:"Mindshaper", element:"Imaginary", rarity:"SR", atk:3, hp:3, ability:"Distort: สุ่ม +1/-1 ATK ชั่วคราว", image:"Mindshaper.png" },
  { code:"NEXUS_ADEPT", name:"Nexus Adept", element:"Neutral", rarity:"N", atk:2, hp:2, ability:"Meditate: ถ้าลงเป็นใบแรกของเทิร์น จั่ว 1", image:"Nexus Adept.png" },
  { code:"ICE_WARDEN", name:"Ice Warden", element:"Cryo", rarity:"SR", atk:4, hp:5, ability:"Frost Armor: โดนโจมตีครั้งแรก -2 ดาเมจ", image:"Ice Warden.png" },
  { code:"CINDER_SCOUT", name:"Cinder Scout", element:"Pyro", rarity:"N", atk:3, hp:2, ability:"Ignite: โดนแล้วติด Burn(1) 1 เทิร์น", image:"Cinder Scout.png" },
  { code:"WAVECALLER", name:"Wavecaller", element:"Hydro", rarity:"R", atk:2, hp:5, ability:"High Tide: เมื่อจั่วใบนี้ ฮีลฮีโร่เรา 1", image:"Wavecaller.png" },
];
