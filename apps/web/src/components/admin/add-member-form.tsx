"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addMemberToWorkspace } from "@/actions/workspace";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { UserPlus, ChevronsUpDown } from "lucide-react";

interface Props {
  workspaceId: string;
  users: Array<{ id: string; username: string }>;
}

export function AddMemberForm({ workspaceId, users }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [role, setRole] = useState("MEMBER");

  const selectedUser = users.find((u) => u.id === selectedUserId);

  async function handleSubmit() {
    if (!selectedUserId) {
      setError("Please select a user");
      return;
    }
    setError(null);
    setLoading(true);

    const result = await addMemberToWorkspace({
      userId: selectedUserId,
      workspaceId,
      role,
    });

    if (!result.success) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setLoading(false);
    setOpen(false);
    setSelectedUserId("");
    setRole("MEMBER");
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <UserPlus className="mr-1 size-3.5" />
        Add Member
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Popover open={userOpen} onOpenChange={setUserOpen}>
        <PopoverTrigger>
          <Button
            variant="outline"
            size="sm"
            className="w-[150px] justify-between text-xs"
          >
            {selectedUser ? selectedUser.username : "Select user..."}
            <ChevronsUpDown className="ml-1 size-3 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-0">
          <Command>
            <CommandInput placeholder="Search users..." />
            <CommandList>
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {users.map((u) => (
                  <CommandItem
                    key={u.id}
                    value={u.username}
                    onSelect={() => {
                      setSelectedUserId(u.id);
                      setUserOpen(false);
                    }}
                    data-checked={selectedUserId === u.id}
                  >
                    {u.username}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
      >
        <option value="MEMBER">Member</option>
        <option value="ADMIN">Admin</option>
        <option value="OWNER">Owner</option>
      </select>
      <Button size="sm" disabled={loading} onClick={handleSubmit}>
        {loading ? "..." : "Add"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setOpen(false);
          setError(null);
          setSelectedUserId("");
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
