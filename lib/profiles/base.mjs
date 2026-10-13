export const description = 'Default; readiness checks only, no build or test commands';

export default function base() {
  return {
    verbs: {},
    doctor: [
      {
        name: 'node',
        check: () => ({
          ok: Number(process.versions.node.split('.')[0]) >= 18,
          detail: `Node ${process.versions.node}; executable ${process.execPath}`,
          fix: 'Install Node.js 18 or newer in the environment running pou.',
        }),
      },
      {
        name: 'config-present',
        check: (context) => ({
          ok: context.hasConfiguration,
          detail: context.configurationPath ?? `No pou config in ${context.currentDirectory}`,
          fix: 'Run pou init from the intended project root, then configure its commands.',
        }),
      },
      {
        name: 'profile-loaded',
        check: (context) => ({ ok: true, detail: `Selected profile: ${context.profile}` }),
      },
    ],
  };
}
