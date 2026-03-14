import { FiTool } from 'react-icons/fi';
import Layout from '../components/Layout';

const UnderDevelopment = ({ title = 'Feature Under Development', description = 'This page is currently being built. Please check back soon.' }) => {
  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>{title}</h1>
          <p>{description}</p>
        </div>

        <section className="surface-card p-10 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 text-primary">
            <FiTool className="h-7 w-7" />
          </div>
          <h2 className="section-title">Under Development</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500">
            We are actively working on this module to bring you a better experience.
          </p>
        </section>
      </div>
    </Layout>
  );
};

export default UnderDevelopment;
