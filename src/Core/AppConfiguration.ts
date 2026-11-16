import * as path from 'path';
import { app } from 'electron';

export interface AppMetadata {
  name: string;
  version: string;
  description: string;
  isPackaged: boolean;
  userDataPath: string;
  logsPath: string;
}

export class AppConfiguration {
  private static instance: AppConfiguration | null = null;
  public readonly metadata: AppMetadata;

  private constructor() {
    const isPackaged = app && 'isPackaged' in app ? Boolean(app.isPackaged) : false;
    const userDataPath = app && typeof app.getPath === 'function' ? app.getPath('userData') : path.join(process.cwd(), '.fseb-data');
    const logsPath = path.join(userDataPath, 'logs');

    this.metadata = {
      name: 'FSEB — Fully Safe Exam Browser',
      version: '0.2.0',
      description: 'Authorized secure desktop examination browser',
      isPackaged,
      userDataPath,
      logsPath,
    };
  }

  public static getInstance(): AppConfiguration {
    if (!AppConfiguration.instance) {
      AppConfiguration.instance = new AppConfiguration();
    }
    return AppConfiguration.instance;
  }
}

