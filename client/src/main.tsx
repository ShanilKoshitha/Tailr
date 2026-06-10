import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import App from './App';
import BoardView from './views/BoardView';
import ResumesView from './views/ResumesView';
import SettingsView from './views/SettingsView';
import StudioView from './views/StudioView';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <BoardView /> },
      { path: 'resumes', element: <ResumesView /> },
      { path: 'settings', element: <SettingsView /> },
    ],
  },
  { path: '/studio/:tailoredId', element: <StudioView /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
