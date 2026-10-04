import { Clock } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Spinner } from "../../components/ui/spinner";

/** Dialog tambah jam posting WIB — preview hari-ini/besok computed by parent. */
export function AddTimeDialog({
  open,
  onOpenChange,
  value,
  onValue,
  valid,
  saving,
  lands,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: string;
  onValue: (v: string) => void;
  valid: boolean;
  saving: boolean;
  lands: (hhmm: string) => "today" | "tomorrow";
  onAdd: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah jam posting</DialogTitle>
          <DialogDescription>
            Jam yang masih di depan hari ini masuk slot hari ini, yang sudah lewat masuk besok.
            Maksimal 6 jam.
          </DialogDescription>
        </DialogHeader>
        <label className="flex flex-col gap-1 text-sm">
          <span className="flex items-center gap-1 text-muted">
            <Clock className="h-3.5 w-3.5" /> Jam (WIB)
          </span>
          <Input
            value={value}
            inputMode="numeric"
            placeholder="cth 19:30"
            maxLength={5}
            onChange={(e) => {
              let v = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
              if (v.length > 2) v = v.slice(0, 2) + ":" + v.slice(2);
              onValue(v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") onAdd();
            }}
            aria-label="Jam baru HH:MM"
          />
        </label>
        <div className="flex flex-wrap gap-1.5">
          {["07:30", "12:00", "17:50", "19:30"].map((t) => (
            <Button key={t} variant="outline" size="sm" onClick={() => onValue(t)}>
              {t}
            </Button>
          ))}
        </div>
        {valid && (
          <p className="text-sm text-accent">
            masuk slot {lands(value.trim()) === "today" ? "HARI INI" : "BESOK"}
            {lands(value.trim()) === "tomorrow" ? " (waktu hari ini sudah lewat)" : " — tick 60 detik jalan otomatis"}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button onClick={onAdd} disabled={!valid || saving}>
            {saving ? <Spinner label="Simpan…" /> : "Tambah"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
