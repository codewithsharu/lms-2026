import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Send cookies with requests
});

// Handle response errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestUrl = error.config?.url || '';
    const isAuthRoute = requestUrl.includes('/auth/');
    const isOnLoginPage = window.location.pathname === '/login';
    
    // Only redirect on 401 if not an auth route and not already on login page
    if (error.response?.status === 401 && !isAuthRoute && !isOnLoginPage) {
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth APIs
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  getProfile: () => api.get('/auth/me'),
  changePassword: (currentPassword, newPassword) => 
    api.put('/auth/change-password', { currentPassword, newPassword }),
  logout: () => api.post('/auth/logout'),
};

// User APIs
export const userAPI = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  create: (userData) => api.post('/users', userData),
  update: (id, userData) => api.put(`/users/${id}`, userData),
  delete: (id) => api.delete(`/users/${id}`),
  resetPassword: (id, newPassword) => api.post(`/users/${id}/reset-password`, { new_password: newPassword }),
  bulkUpload: (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post('/users/bulk-upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  downloadTemplate: (type) => api.get('/users/template/download', {
    params: { type },
    responseType: 'blob'
  }),
};

// Class APIs
export const classAPI = {
  // Classes
  getAll: (params) => api.get('/classes', { params }),
  getById: (id) => api.get(`/classes/${id}`),
  create: (data) => api.post('/classes', data),
  update: (id, data) => api.put(`/classes/${id}`, data),
  delete: (id) => api.delete(`/classes/${id}`),
  
  // Sections
  getSections: (classId) => api.get(`/classes/${classId}/sections`),
  createSection: (classId, data) => api.post(`/classes/${classId}/sections`, data),
  updateSection: (classId, sectionId, data) => api.put(`/classes/${classId}/sections/${sectionId}`, data),
  deleteSection: (classId, sectionId) => api.delete(`/classes/${classId}/sections/${sectionId}`),
  
  // Teacher assignments
  getTeachers: () => api.get('/classes/teachers/list'),
  assignTeacher: (classId, data) => api.post(`/classes/${classId}/assign-teacher`, data),
  removeAssignment: (assignmentId) => api.delete(`/classes/assignments/${assignmentId}`),
};

export const teacherAPI = {
  getAssignedStudents: () => api.get('/classes/teacher/assigned-students'),
  addStudentToClass: (classId, data) => api.post(`/classes/teacher/classes/${classId}/students`, data),
  previewBulkStudents: (classId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post(`/classes/teacher/classes/${classId}/students/bulk-preview`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },
  importBulkStudents: (classId, candidates) => api.post(`/classes/teacher/classes/${classId}/students/bulk-import`, { candidates }),
  updateStudentInClass: (classId, studentId, data) => api.put(`/classes/teacher/classes/${classId}/students/${studentId}`, data),
  deleteStudentFromClass: (classId, studentId) => api.delete(`/classes/teacher/classes/${classId}/students/${studentId}`),
};

export default api;
