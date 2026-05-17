import { useNavigate } from "@tanstack/react-router";
import { LogOut, User as UserIcon } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui";
import { useLogout, useWhoami } from "../hooks";

export function UserMenu() {
  const { data } = useWhoami();
  const navigate = useNavigate();
  const logout = useLogout();

  if (!data?.user) return null;

  const { username, role } = data.user;

  function onLogout() {
    logout.mutate(undefined, {
      onSettled: () => {
        void navigate({ to: "/login" });
      },
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Account menu" className="gap-2 px-2">
          <span className="grid size-6 place-items-center rounded-full bg-[var(--surface-2)] text-[var(--fg-muted)]">
            <UserIcon className="size-3.5" aria-hidden />
          </span>
          <span className="hidden sm:inline text-sm font-medium">{username}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{username}</span>
            <span className="text-xs text-[var(--fg-muted)]">{role}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={onLogout}
          disabled={logout.isPending}
          className="text-danger focus:text-danger"
        >
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
