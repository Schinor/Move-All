import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import {
  faAnglesLeft, faArrowRight, faArrowTrendDown, faArrowTrendUp, faBars, faBell, faBolt, faBox,
  faBoxesStacked, faBuilding, faBullseye, faCalculator, faCalendarDays, faChartColumn, faCheck,
  faChevronDown, faChevronUp, faCircleCheck, faCircleXmark, faClock, faCompass, faCrown, faDesktop,
  faDiagramProject, faEnvelope, faEye, faEyeSlash, faFileCircleCheck, faFileLines, faFire,
  faFireFlameCurved, faFlask, faGem, faGlobe, faIndustry, faKey, faKeyboard, faLightbulb, faLock,
  faMagnifyingGlass, faMedal, faMoneyBillTrendUp, faMoon, faPen, faPenToSquare, faRightFromBracket,
  faCircleHalfStroke, faRobot, faRotateRight, faScroll, faShip, faSliders, faStamp, faStar,
  faTableColumns,
  faThumbtack, faTriangleExclamation, faUser, faWandMagicSparkles, faXmark,
} from '@fortawesome/free-solid-svg-icons';

/**
 * Nomes semânticos usados nos templates. A troca de biblioteca acontece só aqui —
 * nenhum template precisa conhecer o nome do ícone no Font Awesome.
 */
const ICONS = {
  'alert-triangle': faTriangleExclamation,
  'arrow-down-right': faArrowTrendDown,
  'arrow-right': faArrowRight,
  'arrow-up-right': faArrowTrendUp,
  'bar-chart': faChartColumn,
  bell: faBell,
  boxes: faBoxesStacked,
  building: faBuilding,
  calculator: faCalculator,
  calendar: faCalendarDays,
  check: faCheck,
  'check-circle': faCircleCheck,
  'chevron-down': faChevronDown,
  'chevron-up': faChevronUp,
  clock: faClock,
  columns: faTableColumns,
  command: faKeyboard,
  compass: faCompass,
  /* Meia-lua: o faSun do Font Awesome vira um ícone de engrenagem abaixo de ~20px. */
  contrast: faCircleHalfStroke,
  crown: faCrown,
  customs: faStamp,
  diamond: faGem,
  edit: faPen,
  email: faEnvelope,
  eye: faEye,
  'eye-off': faEyeSlash,
  factory: faIndustry,
  'file-check': faFileCircleCheck,
  'file-text': faFileLines,
  fire: faFire,
  flame: faFireFlameCurved,
  flask: faFlask,
  globe: faGlobe,
  kanban: faDiagramProject,
  lightbulb: faLightbulb,
  lock: faLock,
  logout: faRightFromBracket,
  'medal-bronze': faMedal,
  'medal-gold': faMedal,
  'medal-silver': faMedal,
  menu: faBars,
  money: faMoneyBillTrendUp,
  monitor: faDesktop,
  moon: faMoon,
  package: faBox,
  password: faKey,
  'panel-left': faTableColumns,
  'panel-left-close': faAnglesLeft,
  pin: faThumbtack,
  'pin-filled': faThumbtack,
  refresh: faRotateRight,
  robot: faRobot,
  scroll: faScroll,
  search: faMagnifyingGlass,
  ship: faShip,
  sliders: faSliders,
  sparkles: faWandMagicSparkles,
  'square-pen': faPenToSquare,
  star: faStar,
  target: faBullseye,
  'trending-down': faArrowTrendDown,
  'trending-up': faArrowTrendUp,
  user: faUser,
  x: faXmark,
  'x-circle': faCircleXmark,
  zap: faBolt,
} satisfies Record<string, IconDefinition>;

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

@Component({
  selector: 'app-icon',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.css',
})
export class IconComponent {
  readonly name = input.required<IconName>();
  readonly size = input<number>(16);
  /** Rótulo para leitor de tela. Sem ele o ícone é decorativo e fica oculto. */
  readonly label = input<string | null>(null);

  private readonly definition = computed<IconDefinition | null>(() => ICONS[this.name()] ?? null);

  readonly path = computed(() => {
    const icon = this.definition()?.icon[4];
    if (!icon) return '';
    return Array.isArray(icon) ? icon.join(' ') : icon;
  });

  /**
   * Os glifos do Font Awesome têm larguras diferentes (384–640) com altura fixa 512.
   * Normalizamos para uma viewBox quadrada com o glifo centralizado, para que todo
   * ícone ocupe a mesma caixa e alinhe em listas, botões e tabelas.
   */
  readonly viewBox = computed(() => {
    const def = this.definition();
    if (!def) return '0 0 512 512';
    const [width, height] = def.icon;
    const side = Math.max(width, height);
    return `${(width - side) / 2} ${(height - side) / 2} ${side} ${side}`;
  });
}
