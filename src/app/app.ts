import { Component } from '@angular/core';
import { FitAssistant } from './components/fit-assistant/fit-assistant';

@Component({
  selector: 'app-root',
  imports: [FitAssistant],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}