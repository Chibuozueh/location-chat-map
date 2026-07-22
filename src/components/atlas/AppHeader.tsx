import { Link } from "react-router";
import logo from "@/assets/logo.svg";
import { motion } from "framer-motion";

export function AppHeader() {
  return (
    <header className="sticky top-0 z-30 w-full border-b border-border/60 bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
        <Link to="/" className="group flex items-center gap-2.5">
          <motion.span
            initial={{ rotate: -8 }}
            animate={{ rotate: 0 }}
            transition={{ type: "spring", stiffness: 220, damping: 14 }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-card shadow-card ring-soft"
          >
            <img src={logo} alt="" className="h-5 w-5" />
          </motion.span>
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold tracking-[-0.01em]">
              Atlanta Atlas
            </div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Southwest ATL asset map
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
