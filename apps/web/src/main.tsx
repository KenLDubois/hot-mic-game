import { createRoot } from 'react-dom/client';
import { App } from './App';
import { IS_SCREEN } from './client';
import { ScreenApp } from './screens/Screen';
import './styles.css';
import './screen.css';

if (IS_SCREEN) document.documentElement.classList.add('tv');

createRoot(document.getElementById('root')!).render(IS_SCREEN ? <ScreenApp /> : <App />);
