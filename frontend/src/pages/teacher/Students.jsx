import { useEffect, useMemo, useState } from 'react';
import { FiAlertCircle, FiUsers, FiLayers } from 'react-icons/fi';
import Layout from '../../components/Layout';
import { teacherAPI } from '../../services/api';
import Card from '../../components/ui/Card';

const zoneBadgeClass = (zone) => {
  if (zone === 'blue') return 'status-badge info';
  if (zone === 'red') return 'status-badge error';
  if (zone === 'green') return 'status-badge success';
  return 'status-badge warning';
};

const TeacherStudents = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedSectionByClass, setSelectedSectionByClass] = useState({});
  const [assignedData, setAssignedData] = useState({
    assignments: [],
    summary: {
      total_assignments: 0,
      total_students: 0
    }
  });

  useEffect(() => {
    const fetchAssignedStudents = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await teacherAPI.getAssignedStudents();
        setAssignedData(response.data);
      } catch (fetchError) {
        setError(fetchError.response?.data?.error || 'Failed to load assigned students');
      } finally {
        setLoading(false);
      }
    };

    fetchAssignedStudents();
  }, []);

  const groupedByClass = useMemo(() => {
    const classMap = new Map();

    (assignedData.assignments || []).forEach((assignment) => {
      const classId = assignment.class?.id || `unknown-${assignment.assignment_id}`;

      if (!classMap.has(classId)) {
        classMap.set(classId, {
          class: assignment.class || { id: null, name: 'Unknown Class' },
          sections: []
        });
      }

      classMap.get(classId).sections.push({
        assignment_id: assignment.assignment_id,
        section: assignment.section || null,
        zone: assignment.zone,
        students: assignment.students || []
      });
    });

    return Array.from(classMap.values());
  }, [assignedData.assignments]);

  const handleSectionChange = (classKey, sectionKey) => {
    setSelectedSectionByClass((prev) => ({
      ...prev,
      [classKey]: sectionKey
    }));
  };

  return (
    <Layout>
      <div className="app-page">
        <div className="page-header">
          <h1>My Students</h1>
          <p>Choose a class and section to quickly view assigned students.</p>
        </div>

        <Card>
          <Card.Header>
            <h2 className="section-title">Assigned Classes, Sections &amp; Students</h2>
          </Card.Header>
          <Card.Body>

            {loading && (
              <div className="space-y-3">
                {[...Array(3)].map((_, index) => (
                  <div key={index} className="h-16 rounded-xl bg-gray-100 animate-pulse"></div>
                ))}
              </div>
            )}

            {!loading && error && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 p-4 text-red-600">
                <FiAlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            )}

            {!loading && !error && groupedByClass.length === 0 && (
              <p className="text-gray-500">No class/section assignments found for your account.</p>
            )}

            {!loading && !error && groupedByClass.length > 0 && (
              <div className="space-y-6">
                {groupedByClass.map((group) => {
                const classKey = group.class.id || group.class.name;

                const sectionOptions = Array.from(
                  new Map(
                    group.sections.map((sectionAssignment) => {
                      const sectionKey = sectionAssignment.section?.id || '__all__';
                      return [
                        sectionKey,
                        {
                          value: sectionKey,
                          label: sectionAssignment.section?.name || 'All Sections'
                        }
                      ];
                    })
                  ).values()
                );

                const selectedFromState = selectedSectionByClass[classKey];
                const selectedSectionKey = sectionOptions.some((option) => option.value === selectedFromState)
                  ? selectedFromState
                  : (sectionOptions[0]?.value || '__all__');

                const selectedAssignments = group.sections.filter((sectionAssignment) => {
                  const sectionKey = sectionAssignment.section?.id || '__all__';
                  return sectionKey === selectedSectionKey;
                });

                const selectedStudents = Array.from(
                  new Map(
                    selectedAssignments
                      .flatMap((sectionAssignment) => sectionAssignment.students)
                      .map((student) => [student.id, student])
                  ).values()
                );

                const selectedZones = Array.from(
                  new Set(selectedAssignments.map((sectionAssignment) => sectionAssignment.zone || 'All Zones'))
                );

                  return (
                    <div key={classKey} className="overflow-hidden rounded-xl border border-gray-200">
                      <div className="border-b border-gray-200 bg-blue-50/50 px-4 py-3">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-medium text-gray-800">{group.class.name}</p>
                            <p className="text-sm text-gray-500">
                              {group.sections.length} assignment{group.sections.length === 1 ? '' : 's'}
                            </p>
                          </div>
                          <div className="w-full md:w-72">
                            <label className="mb-1 block text-xs font-medium text-gray-500">Section</label>
                            <select
                              value={selectedSectionKey}
                              onChange={(e) => handleSectionChange(classKey, e.target.value)}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-primary focus:ring-2 focus:ring-primary/20"
                            >
                              {sectionOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="status-badge info">
                          <FiUsers className="mr-1 inline-block h-3.5 w-3.5" />
                          {selectedStudents.length} student{selectedStudents.length === 1 ? '' : 's'}
                        </span>
                        <span className="status-badge warning">
                          <FiLayers className="mr-1 inline-block h-3.5 w-3.5" />
                          {selectedZones.join(', ') || 'N/A'}
                        </span>
                      </div>

                      {selectedStudents.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-gray-500">No students match this section assignment.</p>
                      ) : (
                        <div className="table-shell overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Student</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Email</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Roll No.</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Section</th>
                                <th className="px-3 py-2 text-left text-xs font-semibold uppercase text-gray-500">Zone</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                              {selectedStudents.map((student) => (
                                <tr key={`${classKey}-${student.id}`} className="hover:bg-gray-50">
                                  <td className="px-3 py-2 text-sm font-medium text-gray-800">{student.full_name}</td>
                                  <td className="px-3 py-2 text-sm text-gray-600">{student.email}</td>
                                  <td className="px-3 py-2 text-sm text-gray-600">{student.roll_number}</td>
                                  <td className="px-3 py-2 text-sm text-gray-600">{student.section?.name || 'N/A'}</td>
                                  <td className="px-3 py-2 text-sm text-gray-600">
                                    <span className={`${zoneBadgeClass(student.zone)} capitalize`}>
                                      {student.zone || 'N/A'}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </Layout>
  );
};

export default TeacherStudents;
