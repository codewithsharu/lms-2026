const variantClassMap = {
  primary: 'btn btn-primary',
  secondary: 'btn btn-secondary',
  tertiary: 'btn btn-tertiary',
  ghost: 'btn btn-ghost',
  success: 'btn btn-success',
  danger: 'btn btn-danger'
};

const Button = ({
  type = 'button',
  variant = 'primary',
  className = '',
  children,
  ...props
}) => {
  return (
    <button type={type} className={`${variantClassMap[variant] || variantClassMap.primary} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
};

export default Button;
