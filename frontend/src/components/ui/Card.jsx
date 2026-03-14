const Card = ({ className = '', children }) => {
  return <section className={`surface-card ${className}`.trim()}>{children}</section>;
};

const CardHeader = ({ className = '', children }) => {
  return <div className={`p-5 border-b border-gray-100 ${className}`.trim()}>{children}</div>;
};

const CardBody = ({ className = '', children }) => {
  return <div className={`p-5 ${className}`.trim()}>{children}</div>;
};

Card.Header = CardHeader;
Card.Body = CardBody;

export default Card;
