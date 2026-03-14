export const roleAccentClass = {
  admin: 'bg-primary',
  teacher: 'bg-success',
  student: 'bg-gray-500'
};

export const roleBadgeClass = {
  admin: 'bg-primary/10 text-primary',
  teacher: 'bg-success/10 text-success',
  student: 'bg-gray-200 text-gray-700'
};

export const zoneBadgeClass = {
  blue: 'bg-primary text-white',
  red: 'bg-error text-white',
  green: 'bg-success text-white'
};

export const getRoleAccentClass = (role) => roleAccentClass[role] || roleAccentClass.student;
export const getRoleBadgeClass = (role) => roleBadgeClass[role] || roleBadgeClass.student;
export const getZoneBadgeClass = (zone) => zoneBadgeClass[zone] || 'bg-gray-400 text-white';
