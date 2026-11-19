// Alle Symbole der Oberfläche kommen aus Lucide (https://lucide.dev) – als SVG-Strings für die HTML-Vorlagen.
import {
  Archive, ArchiveRestore, ArrowDown, ArrowUp, Calendar, CalendarClock, CalendarSync, CalendarRange, ChartGantt, Check, ChevronLeft,
  ChevronRight, ChevronDown, Circle, Link2, Unlink2, CircleCheck, Clock, Columns2, Diamond, ChevronsDownUp, ChevronsUpDown, CircleArrowDown, Download, Eye, FolderOpen, Grid2x2Plus, Grid2x2X, Hourglass, List, MapPin, Maximize2, Minimize2, Minus,
  NotebookPen, StickyNote, SquareCheck, ListPlus, Paperclip, Pencil, Plus, ImagePlus, RefreshCw, RotateCcw, Rows2, Settings, SquareKanban, Trash2, TriangleAlert, X,
} from 'lucide';

type Knoten = [string, Record<string, string | number | undefined>][];

function svg(knoten: Knoten): string {
  const kinder = knoten.map(([tag, attr]) => `<${tag} ${Object.entries(attr).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="lu" xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${kinder}</svg>`;
}

const k = (n: unknown) => svg(n as Knoten);

export const I = {
  muell: k(Trash2), warnung: k(TriangleAlert), archiv: k(Archive), ausArchiv: k(ArchiveRestore), x: k(X),
  nebeneinander: k(Columns2), untereinander: k(Rows2), maximieren: k(Maximize2), minimieren: k(Minimize2),
  bearbeiten: k(Pencil), einstellungen: k(Settings), plus: k(Plus), minus: k(Minus), bereichNeu: k(Grid2x2Plus), aktualisierung: k(Download), appUpdate: k(CircleArrowDown), gesehen: k(Eye), ordner: k(FolderOpen), bereichLoeschen: k(Grid2x2X), zuruecksetzen: k(RotateCcw),
  wiedervorlage: k(CalendarClock), frist: k(Diamond), ort: k(MapPin),
  liste: k(List), board: k(SquareKanban), tag: k(Calendar), mehrtage: k(CalendarRange), timeline: k(ChartGantt),
  links: k(ChevronLeft), rechts: k(ChevronRight), haken: k(Check), aktualisieren: k(RefreshCw), kalenderSync: k(CalendarSync), ausklappen: k(ChevronsUpDown), einklappen: k(ChevronsDownUp),
  termin: k(Clock), reservierung: k(Hourglass), offen: k(Circle), erledigt: k(CircleCheck),
  hoch: k(ArrowUp), runter: k(ArrowDown), anhang: k(Paperclip), bildHinzu: k(ImagePlus),
  logbuch: k(NotebookPen), notiz: k(StickyNote), punkt: k(SquareCheck), zurAufgabe: k(ListPlus),
  spiegel: k(Link2), spiegelLoesen: k(Unlink2), aufklappen: k(ChevronDown),
};
