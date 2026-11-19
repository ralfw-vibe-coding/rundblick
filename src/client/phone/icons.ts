// Symbole der Phone App – ausschließlich Lucide, als SVG-Strings (Klasse „lucide“ wie im Entwurf).
import {
  Archive, ArrowUpToLine, CalendarClock, Check, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleArrowDown, CircleCheck, Cloud,
  CloudCheck, CloudOff, CloudUpload, Diamond, Eye, HardDrive, ImagePlus, List, Lock, LogIn, MapPin, NotebookPen, Plus, RefreshCw, Repeat, Search,
  Settings, SquareCheck, SquareKanban, StickyNote, Trash2, X,
} from 'lucide';

type Knoten = [string, Record<string, string | number | undefined>][];
const svg = (n: unknown) => `<svg class="lucide" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${
  (n as Knoten).map(([tag, attr]) => `<${tag} ${Object.entries(attr).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('')}</svg>`;

export const I = {
  archiv: svg(Archive), nachOben: svg(ArrowUpToLine), wiedervorlage: svg(CalendarClock), wiederholung: svg(Repeat), haken: svg(Check), zurueck: svg(ChevronLeft),
  rechts: svg(ChevronRight), hoch: svg(ChevronUp), kreis: svg(Circle), update: svg(CircleArrowDown), erledigt: svg(CircleCheck), wolke: svg(Cloud),
  wolkeOk: svg(CloudCheck), wolkeAus: svg(CloudOff), wolkeHoch: svg(CloudUpload), frist: svg(Diamond), gesehen: svg(Eye), speicher: svg(HardDrive),
  bildNeu: svg(ImagePlus), liste: svg(List), schloss: svg(Lock), anmelden: svg(LogIn), ort: svg(MapPin), logbuch: svg(NotebookPen), plus: svg(Plus),
  abgleichen: svg(RefreshCw), suche: svg(Search), einstellungen: svg(Settings), punkt: svg(SquareCheck), board: svg(SquareKanban), notiz: svg(StickyNote),
  muell: svg(Trash2), x: svg(X),
};
