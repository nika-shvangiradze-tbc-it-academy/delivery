import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { courierGuard } from './core/guards/courier.guard';
import { roleHomeGuard } from './core/guards/role-home.guard';
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    canActivate: [roleHomeGuard],
    loadComponent: () =>
      import('./layout/delivery-main/delivery-main').then((m) => m.DeliveryMain),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    loadComponent: () => import('./features/auth/register/register').then((m) => m.Register),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./features/profile/profile').then((m) => m.ProfilePage),
  },
  {
    path: 'create-order',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/orders/create-order/create-order').then((m) => m.CreateOrder),
  },
  {
    path: 'my-orders',
    canActivate: [authGuard],
    loadComponent: () => import('./features/orders/my-orders/my-orders').then((m) => m.MyOrders),
  },
  {
    path: 'orders',
    redirectTo: 'my-orders',
    pathMatch: 'full',
  },
  {
    path: 'admin',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./features/admin/dashboard/dashboard').then((m) => m.AdminDashboard),
  },
  {
    path: 'admin/orders',
    canActivate: [adminGuard],
    loadComponent: () => import('./features/admin/orders/orders').then((m) => m.AdminOrders),
  },
  {
    path: 'admin/pickup-tasks',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./features/admin/pickup-tasks/pickup-tasks').then((m) => m.AdminPickupTasks),
  },
  {
    path: 'courier',
    canActivate: [courierGuard],
    loadComponent: () =>
      import('./features/courier/courier-shell/courier-shell').then((m) => m.CourierShell),
    children: [
      {
        path: '',
        redirectTo: 'orders',
        pathMatch: 'full',
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/courier/courier-orders/courier-orders').then((m) => m.CourierOrders),
      },
      {
        path: 'history',
        loadComponent: () =>
          import('./features/courier/courier-history/courier-history').then((m) => m.CourierHistory),
      },
      {
        path: 'order/:id',
        loadComponent: () =>
          import('./features/courier/courier-order-detail/courier-order-detail').then(
            (m) => m.CourierOrderDetail,
          ),
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
