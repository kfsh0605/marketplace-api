import * as k8s from '@pulumi/kubernetes';
import * as pulumi from '@pulumi/pulumi';
import { APP_PORT, PROBE_PATHS, PROFILE_SPECS } from './src/profiles';
import { loadSettings } from './src/settings';

const settings = loadSettings(process.env);
const spec = PROFILE_SPECS[settings.profile];

const provider = new k8s.Provider('kind', { context: settings.context });
const opts: pulumi.CustomResourceOptions = { provider };

const APP = 'marketplace-api';
const labels = { app: APP };

const namespace = new k8s.core.v1.Namespace('ns', { metadata: { name: settings.namespace, labels } }, opts);

const encoded = Object.fromEntries(
    Object.entries(settings.secrets).map(([key, value]) => [key, Buffer.from(value, 'utf8').toString('base64')]),
);

const secret = new k8s.core.v1.Secret(
    'secrets',
    {
        metadata: { name: 'marketplace-secrets', namespace: namespace.metadata.name, labels },
        type: 'Opaque',
        data: pulumi.secret(encoded),
    },
    opts,
);

const readinessProbe: k8s.types.input.core.v1.Probe | undefined = spec.probes
    ? {
        httpGet: { path: PROBE_PATHS.readiness, port: APP_PORT },
        periodSeconds: 1,
        timeoutSeconds: 1,
        failureThreshold: 2,
        successThreshold: 1,
    }
    : undefined;

const livenessProbe: k8s.types.input.core.v1.Probe | undefined = spec.probes
    ? {
        httpGet: { path: PROBE_PATHS.liveness, port: APP_PORT },
        initialDelaySeconds: 15,
        periodSeconds: 10,
        timeoutSeconds: 2,
        failureThreshold: 3,
    }
    : undefined;

const deployment = new k8s.apps.v1.Deployment(
    'deployment',
    {
        metadata: { name: APP, namespace: namespace.metadata.name, labels },
        spec: {
            replicas: settings.replicas,
            revisionHistoryLimit: 3,
            progressDeadlineSeconds: 180,
            selector: { matchLabels: labels },
            strategy: { type: 'RollingUpdate', rollingUpdate: spec.strategy },
            template: {
                metadata: { labels },
                spec: {
                    terminationGracePeriodSeconds: spec.gracePeriodSeconds,
                    securityContext: {
                        runAsNonRoot: true,
                        runAsUser: 65532,
                        runAsGroup: 65532,
                        seccompProfile: { type: 'RuntimeDefault' },
                    },
                    containers: [
                        {
                            name: 'api',
                            image: settings.image,
                            imagePullPolicy: 'IfNotPresent',
                            ports: [{ name: 'http', containerPort: APP_PORT }],
                            env: [
                                { name: 'PORT', value: String(APP_PORT) },
                                { name: 'REV', value: settings.rev },
                                { name: 'WARMUP_MS', value: '4000' },
                                { name: 'DRAIN_MS', value: String(spec.drainMs) },
                                {
                                    name: 'DB_PASSWORD',
                                    valueFrom: { secretKeyRef: { name: secret.metadata.name, key: 'DB_PASSWORD' } },
                                },
                            ],
                            resources: {
                                requests: { cpu: '50m', memory: '64Mi' },
                                limits: { memory: '192Mi' },
                            },
                            securityContext: {
                                allowPrivilegeEscalation: false,
                                readOnlyRootFilesystem: true,
                                capabilities: { drop: ['ALL'] },
                            },
                            readinessProbe,
                            livenessProbe,
                        },
                    ],
                },
            },
        },
    },
    opts,
);

const service = new k8s.core.v1.Service(
    'service',
    {
        metadata: { name: APP, namespace: namespace.metadata.name, labels },
        spec: {
            type: 'NodePort',
            selector: labels,
            ports: [{ name: 'http', port: 80, targetPort: 'http', nodePort: 30080 }],
        },
    },
    opts,
);

const pdb = new k8s.policy.v1.PodDisruptionBudget(
    'pdb',
    {
        metadata: { name: APP, namespace: namespace.metadata.name, labels },
        spec: { minAvailable: settings.replicas - 1, selector: { matchLabels: labels } },
    },
    opts,
);

const hpa = new k8s.autoscaling.v2.HorizontalPodAutoscaler(
    'hpa',
    {
        metadata: { name: APP, namespace: namespace.metadata.name, labels },
        spec: {
            scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: deployment.metadata.name },
            minReplicas: 2,
            maxReplicas: 4,
            metrics: [{ type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } } }],
        },
    },
    opts,
);

export const namespaceName = namespace.metadata.name;
export const profile = settings.profile;
export const rev = settings.rev;
export const nodePort = service.spec.ports[0].nodePort;
export const pdbMinAvailable = pdb.spec.minAvailable;
export const hpaRange = pulumi.interpolate`${hpa.spec.minReplicas}-${hpa.spec.maxReplicas}`;