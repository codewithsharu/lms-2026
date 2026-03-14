const SelectField = ({ label, className = '', selectClassName = '', children, ...props }) => {
  return (
    <div className={className}>
      {label && <label className="form-label">{label}</label>}
      <select className={`form-select ${selectClassName}`.trim()} {...props}>
        {children}
      </select>
    </div>
  );
};

export default SelectField;
