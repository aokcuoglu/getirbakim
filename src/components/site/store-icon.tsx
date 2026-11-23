"use client";

// #1213: lucide's Icon module is a client boundary, so every icon rendered by a server component put its full
// definition (first use) or a long dedupe reference with undefined ref/className props (each repeat) into the RSC
// flight. A client wrapper keyed by icon name makes the flight carry only the name and the plain props, and the
// server HTML stays identical. Pass serialisable props only (no functions, no refs). Client components import lucide
// directly. Keep this file's only export StoreIcon: every extra client export a server file imports is another module row.
import { ArrowRight, CalendarCheck, CarFront, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, ClipboardCheck, Clock, CreditCard, Headphones, Images, Info, Layers, LockKeyhole, MapPin, Package, PackageCheck, RotateCcw, Search, ShieldCheck, ShoppingCart, Trash2, Truck, Undo2, UserRound, Wrench, X, type LucideProps } from "lucide-react";

const icons = {
  "arrow-right": ArrowRight,
  "calendar-check": CalendarCheck,
  "car-front": CarFront,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  "clipboard-check": ClipboardCheck,
  clock: Clock,
  "credit-card": CreditCard,
  headphones: Headphones,
  images: Images,
  info: Info,
  layers: Layers,
  "lock-keyhole": LockKeyhole,
  "map-pin": MapPin,
  package: Package,
  "package-check": PackageCheck,
  "rotate-ccw": RotateCcw,
  search: Search,
  "shield-check": ShieldCheck,
  "shopping-cart": ShoppingCart,
  "trash-2": Trash2,
  truck: Truck,
  "undo-2": Undo2,
  "user-round": UserRound,
  wrench: Wrench,
  x: X,
} as const;

export function StoreIcon({ name, ...props }: { name: keyof typeof icons } & Omit<LucideProps, "ref">) {
  const Icon = icons[name];
  return <Icon {...props} />;
}
