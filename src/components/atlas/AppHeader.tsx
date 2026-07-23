import { Link } from "react-router";
import { motion } from "framer-motion";
import { LsiLogo, LsiMark } from "@/components/atlas/LsiLogo";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link to="/" className="group flex items-center gap-3">
          <motion.span
            initial={{ rotate: -8 }}
            animate={{ rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 14 }}
            className="inline-flex items-center justify-center rounded-lg bg-card shadow-card ring-soft overflow-hidden"
            style={{ width: 36, height: 42 }}
          >
            <LsiMark size={26} />
          </motion.span>
          <LsiLogo size="sm" withWordmark={false} className="-ml-1" />
          <span className="hidden h-7 w-px bg-border/70 sm:block" />
          <div className="hidden leading-tight sm:block">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Southwest ATL asset map
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.14em] text-foreground/60">
              Atlanta · Georgia
            </div>
          </div>
        </Link>
      </div>
    </header>
  );
}
