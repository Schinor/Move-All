import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ThemeService } from '../../../core/services/theme.service';
import { IconComponent } from '../../ui/icon/icon.component';

/** Barra superior: busca global e toggle de tema. */
@Component({
  selector: 'app-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  templateUrl: './top-bar.component.html',
  styleUrl: './top-bar.component.css',
})
export class TopBarComponent {
  private readonly themeService = inject(ThemeService);
  readonly theme = this.themeService.theme;

  toggleTheme(): void {
    this.themeService.toggle();
  }
}
