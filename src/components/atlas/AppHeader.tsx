import { Link } from "react-router";
import { motion } from "framer-motion";
import { MorehouseMark } from "@/components/atlas/MorehouseLogo";
import { LsiLogo } from "@/components/atlas/LsiLogo";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
        <Link to="/" className="group flex items-center gap-3">
          <motion.span
            initial={{ rotate: -8 }}
            animate={{ rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 14 }}
            className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-card shadow-card ring-soft overflow-hidden"
          >
            <MorehouseMark size={32} />
          </motion.span>
          <div className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-[15px] font-bold uppercase tracking-[0.04em] text-[#6E0E1E]">
              Morehouse
            </span>
            <span className="mt-1 font-sans text-[9.5px] uppercase tracking-[0.22em] text-foreground/60">
              Southwest ATL asset map
            </span>
          </div>
          <span className="hidden h-9 w-px bg-border/70 md:block" />
          <LsiLogo size="sm" hideInstitution className="hidden md:inline-flex" />
        </Link>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-full border border-border/70 bg-background/60 px-3 py-1 font-sans text-[10.5px] uppercase tracking-[0.18em] text-foreground/70 sm:inline-flex">
            Atlanta · Georgia
          </span>
        </div>
      </div>
    </header>
  );
}
