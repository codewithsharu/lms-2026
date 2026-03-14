import { FiAlertCircle, FiCheckCircle } from 'react-icons/fi';

const iconByType = {
  error: FiAlertCircle,
  success: FiCheckCircle
};

const Alert = ({ type = 'error', children, className = '' }) => {
  const Icon = iconByType[type] || FiAlertCircle;
  const toneClass = type === 'success' ? 'alert alert-success' : 'alert alert-error';

  return (
    <div className={`${toneClass} ${className}`.trim()}>
      <Icon className="w-5 h-5" />
      <span>{children}</span>
    </div>
  );
};

export default Alert;
