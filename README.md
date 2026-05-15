# TaskFlow Backend API

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

3. Update `.env` with your MongoDB URI and JWT secret.

4. Run development server:
```bash
npm run dev
```

5. Run production:
```bash
npm start
```

## API Endpoints

### Auth
- POST /api/auth/signup
- POST /api/auth/login
- GET /api/auth/me
- PUT /api/auth/update-profile
- PUT /api/auth/change-password

### Projects
- GET /api/projects
- POST /api/projects
- GET /api/projects/:id
- PUT /api/projects/:id
- DELETE /api/projects/:id
- POST /api/projects/:id/members
- DELETE /api/projects/:id/members/:userId

### Tasks
- GET /api/tasks
- POST /api/tasks
- GET /api/tasks/:id
- PUT /api/tasks/:id
- DELETE /api/tasks/:id
- POST /api/tasks/:id/comments
- DELETE /api/tasks/:id/comments/:commentId

### Dashboard
- GET /api/dashboard

### Users
- GET /api/users (admin only)
- GET /api/users/search
- GET /api/users/:id
- PUT /api/users/:id/role (admin only)
- DELETE /api/users/:id (admin only)

## Railway Deployment

1. Push to GitHub
2. Connect repo to Railway
3. Add environment variables in Railway dashboard
4. Deploy!
