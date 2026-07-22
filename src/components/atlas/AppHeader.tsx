import { Link } from "react-router";
import { motion } from "framer-motion";
import { MorehouseLogo, MorehouseMark } from "@/components/atlas/MorehouseLogo";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link to="/" className="group flex items-center gap-3">
          <motion.span
            initial={{ rotate: -8 }}
            animate={{ rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 14 }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-card shadow-card ring-soft overflow-hidden"
          >
            <MorehouseMark size={22} />
          </motion.span>
          <MorehouseLogo size="sm" withWordmark={false} className="-ml-1" />
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
        <div className="flex items-center gap-2">
          <Link
            to="/auth"
            className="hidden rounded-full px-3 py-1.5 text-[12.5px] font-medium text-foreground/80 transition hover:text-foreground md:inline-flex"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground shadow-card transition hover:bg-primary/95"
          >
            Explore Atlas
          </Link>
        </div>
      </div>
    </header>
  );
}
