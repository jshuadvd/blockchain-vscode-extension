/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

import Dockerode = require('dockerode');
import { Container, Volume } from 'dockerode';
import ContainerImpl = require('dockerode/lib/container');
import VolumeImpl = require('dockerode/lib/volume');
import * as child_process from 'child_process';
import { FabricRuntime, FabricRuntimeState } from '../../src/fabric/FabricRuntime';

import * as chai from 'chai';
import * as sinon from 'sinon';
import { OutputAdapter } from '../../src/logging/OutputAdapter';
import { ExtensionUtil } from '../../src/util/ExtensionUtil';
import { TestUtil } from '../TestUtil';
import { UserInputUtil } from '../../src/commands/UserInputUtil';
import * as path from 'path';
import * as fs from 'fs-extra';
import { VSCodeBlockchainOutputAdapter } from '../../src/logging/VSCodeBlockchainOutputAdapter';
import { LogType } from '../../src/logging/OutputAdapter';
import { CommandUtil } from '../../src/util/CommandUtil';
import { VSCodeBlockchainDockerOutputAdapter } from '../../src/logging/VSCodeBlockchainDockerOutputAdapter';
import { FabricGateway } from '../../src/fabric/FabricGateway';
import { FabricNode } from '../../src/fabric/FabricNode';
import { FabricIdentity } from '../../src/fabric/FabricIdentity';
import * as os from 'os';
import { FabricRuntimeUtil } from '../../src/fabric/FabricRuntimeUtil';
import { FabricWalletUtil } from '../../src/fabric/FabricWalletUtil';

chai.should();

// tslint:disable no-unused-expression
describe('FabricRuntime', () => {

    const originalPlatform: string = process.platform;
    const originalSpawn: any = child_process.spawn;
    const rootPath: string = path.dirname(__dirname);

    let runtime: FabricRuntime;
    let sandbox: sinon.SinonSandbox;
    let mockPeerContainer: sinon.SinonStubbedInstance<Container>;
    let mockOrdererContainer: sinon.SinonStubbedInstance<Container>;
    let mockCAContainer: sinon.SinonStubbedInstance<Container>;
    let mockCouchContainer: sinon.SinonStubbedInstance<Container>;
    let mockLogsContainer: sinon.SinonStubbedInstance<Container>;
    let mockPeerInspect: any;
    let mockOrdererInspect: any;
    let mockCAInspect: any;
    let mockCouchInspect: any;
    let mockLogsInspect: any;
    let mockPeerVolume: sinon.SinonStubbedInstance<Volume>;
    let mockOrdererVolume: sinon.SinonStubbedInstance<Volume>;
    let mockCAVolume: sinon.SinonStubbedInstance<Volume>;
    let mockCouchVolume: sinon.SinonStubbedInstance<Volume>;
    let mockLogsVolume: sinon.SinonStubbedInstance<Volume>;
    let connectionProfilePath: string;
    let ensureFileStub: sinon.SinonStub;
    let writeFileStub: sinon.SinonStub;
    let removeStub: sinon.SinonStub;
    let errorSpy: sinon.SinonSpy;
    let runtimeDir: string;

    // tslint:disable max-classes-per-file
    class TestFabricOutputAdapter implements OutputAdapter {

        public log(value: string): void {
            console.log(value);
        }

        public error(value: string): void {
            console.error(value);
        }
    }

    function mockSuccessCommand(): any {
        if (originalPlatform === 'win32') {
            return originalSpawn('cmd', ['/c', 'echo stdout&& echo stderr>&2&& exit 0']);
        } else {
            return originalSpawn('/bin/sh', ['-c', 'echo stdout && echo stderr >&2 && true']);
        }
    }

    function mockFailureCommand(): any {
        if (originalPlatform === 'win32') {
            return originalSpawn('cmd', ['/c', 'echo stdout&& echo stderr>&2&& exit 1']);
        } else {
            return originalSpawn('/bin/sh', ['-c', 'echo stdout && echo stderr >&2 && false']);
        }
    }

    before(async () => {
        await TestUtil.storeRuntimesConfig();
    });

    after(async () => {
        await TestUtil.restoreRuntimesConfig();
    });

    beforeEach(async () => {
        await ExtensionUtil.activateExtension();
        runtime = new FabricRuntime();
        runtime.ports = {
            orderer: 12347,
            peerRequest: 12345,
            peerChaincode: 54321,
            peerEventHub: 12346,
            certificateAuthority: 12348,
            couchDB: 12349,
            logs: 12387
        };
        runtime.developmentMode = false;
        sandbox = sinon.createSandbox();

        const docker: Dockerode = (runtime as any).docker['docker'];
        mockPeerContainer = sinon.createStubInstance(ContainerImpl);
        mockPeerInspect = {
            NetworkSettings: {
                Ports: {
                    '7051/tcp': [{ HostIp: '0.0.0.0', HostPort: '12345' }],
                    '7052/tcp': [{ HostIp: '0.0.0.0', HostPort: '54321' }],
                    '7053/tcp': [{ HostIp: '0.0.0.0', HostPort: '12346' }]
                }
            },
            State: {
                Running: true
            }
        };
        mockPeerContainer.inspect.resolves(mockPeerInspect);
        mockOrdererContainer = sinon.createStubInstance(ContainerImpl);
        mockOrdererInspect = {
            NetworkSettings: {
                Ports: {
                    '7050/tcp': [{ HostIp: '127.0.0.1', HostPort: '12347' }]
                }
            },
            State: {
                Running: true
            }
        };
        mockOrdererContainer.inspect.resolves(mockOrdererInspect);
        mockCAContainer = sinon.createStubInstance(ContainerImpl);
        mockCAInspect = {
            NetworkSettings: {
                Ports: {
                    '7054/tcp': [{ HostIp: '127.0.0.1', HostPort: '12348' }]
                }
            },
            State: {
                Running: true
            }
        };
        mockCAContainer.inspect.resolves(mockCAInspect);
        mockCouchContainer = sinon.createStubInstance(ContainerImpl);
        mockCouchInspect = {
            NetworkSettings: {
                Ports: {
                    '5984/tcp': [{ HostIp: '127.0.0.1', HostPort: '12349' }]
                }
            },
            State: {
                Running: true
            }
        };
        mockCouchContainer.inspect.resolves(mockCouchInspect);

        mockLogsContainer = sinon.createStubInstance(ContainerImpl);
        mockLogsInspect = {
            NetworkSettings: {
                Ports: {
                    '80/tcp': [{ HostIp: '0.0.0.0', HostPort: 12387 }]
                }
            },
            State: {
                Running: true
            }
        };
        mockLogsContainer.inspect.resolves(mockLogsInspect);
        const getContainerStub: sinon.SinonStub = sandbox.stub(docker, 'getContainer');
        getContainerStub.withArgs('fabricvscodelocalfabric_peer0.org1.example.com').returns(mockPeerContainer);
        getContainerStub.withArgs('fabricvscodelocalfabric_orderer.example.com').returns(mockOrdererContainer);
        getContainerStub.withArgs('fabricvscodelocalfabric_ca.example.com').returns(mockCAContainer);
        getContainerStub.withArgs('fabricvscodelocalfabric_couchdb').returns(mockCouchContainer);
        getContainerStub.withArgs('fabricvscodelocalfabric_logs').returns(mockLogsContainer);
        mockPeerVolume = sinon.createStubInstance(VolumeImpl);
        mockOrdererVolume = sinon.createStubInstance(VolumeImpl);
        mockCAVolume = sinon.createStubInstance(VolumeImpl);
        mockCouchVolume = sinon.createStubInstance(VolumeImpl);
        mockLogsVolume = sinon.createStubInstance(VolumeImpl);
        const getVolumeStub: sinon.SinonStub = sandbox.stub(docker, 'getVolume');
        getVolumeStub.withArgs('fabricvscodelocalfabric_peer0.org1.example.com').returns(mockPeerVolume);
        getVolumeStub.withArgs('fabricvscodelocalfabric_orderer.example.com').returns(mockOrdererVolume);
        getVolumeStub.withArgs('fabricvscodelocalfabric_ca.example.com').returns(mockCAVolume);
        getVolumeStub.withArgs('fabricvscodelocalfabric_couchdb').returns(mockCouchVolume);
        getVolumeStub.withArgs('fabricvscodelocalfabric_logs').returns(mockLogsVolume);

        runtimeDir = path.join(rootPath, '..', 'data');
        sandbox.stub(UserInputUtil, 'getDirPath').returns(runtimeDir);
        ensureFileStub = sandbox.stub(fs, 'ensureFileSync').resolves();
        writeFileStub = sandbox.stub(fs, 'writeFileSync').resolves();
        removeStub = sandbox.stub(fs, 'remove').resolves();
    });

    afterEach(async () => {
        sandbox.restore();
    });

    describe('#getName', () => {

        it('should return the name of the runtime', () => {
            runtime.getName().should.equal(FabricRuntimeUtil.LOCAL_FABRIC);
        });
    });

    describe('#isBusy', () => {

        it('should return false if the runtime is not busy', () => {
            runtime.isBusy().should.be.false;
        });

        it('should return true if the runtime is busy', () => {
            (runtime as any).busy = true;
            runtime.isBusy().should.be.true;
        });
    });

    describe('#getState', () => {

        it('should return starting if the runtime is starting', () => {
            (runtime as any).state = FabricRuntimeState.STARTING;
            runtime.getState().should.equal(FabricRuntimeState.STARTING);
        });

        it('should return stopping if the runtime is stopping', () => {
            (runtime as any).state = FabricRuntimeState.STOPPING;
            runtime.getState().should.equal(FabricRuntimeState.STOPPING);
        });

        it('should return restarting if the runtime is restarting', () => {
            (runtime as any).state = FabricRuntimeState.RESTARTING;
            runtime.getState().should.equal(FabricRuntimeState.RESTARTING);
        });

        it('should return stopped if the runtime is stopped', () => {
            (runtime as any).state = FabricRuntimeState.STOPPED;
            runtime.getState().should.equal(FabricRuntimeState.STOPPED);
        });

        it('should return started if the runtime is started', () => {
            (runtime as any).state = FabricRuntimeState.STARTED;
            runtime.getState().should.equal(FabricRuntimeState.STARTED);
        });
    });

    ['start', 'stop', 'teardown'].forEach((verb: string) => {

        describe(`#${verb}`, () => {

            let setStateSpy: sinon.SinonSpy;
            let stopLogsStub: sinon.SinonStub;

            beforeEach(() => {
                setStateSpy = sandbox.spy(runtime, 'setState');
                stopLogsStub = sandbox.stub(runtime, 'stopLogs');
            });

            it(`should execute the ${verb}.sh script and handle success for non-development mode (Linux/MacOS)`, async () => {
                sandbox.stub(process, 'platform').value('linux');
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('/bin/sh', [`${verb}.sh`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });
                await runtime[verb]();
                spawnStub.should.have.been.calledOnce;
                spawnStub.should.have.been.calledWith('/bin/sh', [`${verb}.sh`], sinon.match.any);
                spawnStub.getCall(0).args[2].env.CORE_CHAINCODE_MODE.should.equal('net');

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should execute the ${verb}.sh script and handle success for development mode (Linux/MacOS)`, async () => {
                sandbox.stub(process, 'platform').value('linux');
                runtime.developmentMode = true;
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('/bin/sh', [`${verb}.sh`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });
                await runtime[verb]();
                spawnStub.should.have.been.calledOnce;
                spawnStub.should.have.been.calledWith('/bin/sh', [`${verb}.sh`], sinon.match.any);
                spawnStub.getCall(0).args[2].env.CORE_CHAINCODE_MODE.should.equal('dev');

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should execute the ${verb}.sh script and handle an error (Linux/MacOS)`, async () => {
                sandbox.stub(process, 'platform').value('linux');
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('/bin/sh', [`${verb}.sh`], sinon.match.any).callsFake(() => {
                    return mockFailureCommand();
                });
                await runtime[verb]().should.be.rejectedWith(`Failed to execute command "/bin/sh" with  arguments "${verb}.sh" return code 1`);
                spawnStub.should.have.been.calledOnce;
                spawnStub.should.have.been.calledWith('/bin/sh', [`${verb}.sh`], sinon.match.any);

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should execute the ${verb}.sh script using a custom output adapter (Linux/MacOS)`, async () => {
                sandbox.stub(process, 'platform').value('linux');
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('/bin/sh', [`${verb}.sh`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });
                const outputAdapter: sinon.SinonStubbedInstance<TestFabricOutputAdapter> = sinon.createStubInstance(TestFabricOutputAdapter);
                await runtime[verb](outputAdapter);
                outputAdapter.log.getCall(0).should.have.been.calledWith(LogType.INFO, undefined, 'stdout');
                outputAdapter.log.getCall(1).should.have.been.calledWith(LogType.INFO, undefined, 'stderr');

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should publish busy events and set state before and after handling success (Linux/MacOS)`, async () => {
                sandbox.stub(process, 'platform').value('linux');
                const eventStub: sinon.SinonStub = sinon.stub();
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('/bin/sh', [`${verb}.sh`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });
                runtime.on('busy', eventStub);

                if (verb === 'start') {
                    sandbox.stub(runtime, 'isRunning').resolves(true);
                } else {
                    sandbox.stub(runtime, 'isRunning').resolves(false);
                }

                await runtime[verb]();
                eventStub.should.have.been.calledTwice;
                eventStub.should.have.been.calledWithExactly(true);
                eventStub.should.have.been.calledWithExactly(false);

                if (verb === 'start') {
                    runtime.getState().should.equal(FabricRuntimeState.STARTED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STARTING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);

                } else if (verb === 'stop' || verb === 'teardown') {
                    runtime.getState().should.equal(FabricRuntimeState.STOPPED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STOPPING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STOPPED);
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should publish busy events and set state before and after handling an error (Linux/MacOS)`, async () => {
                sandbox.stub(process, 'platform').value('linux');
                const eventStub: sinon.SinonStub = sinon.stub();
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('/bin/sh', [`${verb}.sh`], sinon.match.any).callsFake(() => {
                    return mockFailureCommand();
                });

                if (verb === 'start') {
                    sandbox.stub(runtime, 'isRunning').resolves(false);
                } else {
                    sandbox.stub(runtime, 'isRunning').resolves(true);
                }
                runtime.on('busy', eventStub);

                await runtime[verb]().should.be.rejectedWith(`Failed to execute command "/bin/sh" with  arguments "${verb}.sh" return code 1`);
                eventStub.should.have.been.calledTwice;
                eventStub.should.have.been.calledWithExactly(true);
                eventStub.should.have.been.calledWithExactly(false);

                if (verb === 'start') {
                    runtime.getState().should.equal(FabricRuntimeState.STOPPED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STARTING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STOPPED);

                } else if (verb === 'stop' || verb === 'teardown') {
                    runtime.getState().should.equal(FabricRuntimeState.STARTED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STOPPING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should execute the ${verb}.cmd script and handle success for non-development mode (Windows)`, async () => {
                sandbox.stub(process, 'platform').value('win32');
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('cmd', ['/c', `${verb}.cmd`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });
                await runtime[verb]();
                spawnStub.should.have.been.calledOnce;
                spawnStub.should.have.been.calledWith('cmd', ['/c', `${verb}.cmd`], sinon.match.any);
                spawnStub.getCall(0).args[2].env.CORE_CHAINCODE_MODE.should.equal('net');

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should execute the ${verb}.cmd script and handle success for development mode (Windows)`, async () => {
                sandbox.stub(process, 'platform').value('win32');
                runtime.developmentMode = true;
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('cmd', ['/c', `${verb}.cmd`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });
                await runtime[verb]();
                spawnStub.should.have.been.calledOnce;
                spawnStub.should.have.been.calledWith('cmd', ['/c', `${verb}.cmd`], sinon.match.any);
                spawnStub.getCall(0).args[2].env.CORE_CHAINCODE_MODE.should.equal('dev');

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should execute the ${verb}.cmd script and handle an error (Windows)`, async () => {
                sandbox.stub(process, 'platform').value('win32');
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('cmd', ['/c', `${verb}.cmd`], sinon.match.any).callsFake(() => {
                    return mockFailureCommand();
                });
                await runtime[verb]().should.be.rejectedWith(`Failed to execute command "cmd" with  arguments "/c, ${verb}.cmd" return code 1`);
                spawnStub.should.have.been.calledOnce;
                spawnStub.should.have.been.calledWith('cmd', ['/c', `${verb}.cmd`], sinon.match.any);

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should execute the ${verb}.cmd script using a custom output adapter (Windows)`, async () => {
                sandbox.stub(process, 'platform').value('win32');
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('cmd', ['/c', `${verb}.cmd`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });
                const outputAdapter: sinon.SinonStubbedInstance<TestFabricOutputAdapter> = sinon.createStubInstance(TestFabricOutputAdapter);
                await runtime[verb](outputAdapter);
                outputAdapter.log.getCall(0).should.have.been.calledWith(LogType.INFO, undefined, 'stdout');
                outputAdapter.log.getCall(1).should.have.been.calledWith(LogType.INFO, undefined, 'stderr');

                if (verb !== 'start') {
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should publish busy events and set state before and after handling success (Windows)`, async () => {
                sandbox.stub(process, 'platform').value('win32');
                const eventStub: sinon.SinonStub = sinon.stub();
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('cmd', ['/c', `${verb}.cmd`], sinon.match.any).callsFake(() => {
                    return mockSuccessCommand();
                });

                if (verb === 'start') {
                    sandbox.stub(runtime, 'isRunning').resolves(true);
                } else {
                    sandbox.stub(runtime, 'isRunning').resolves(false);
                }

                runtime.on('busy', eventStub);
                await runtime[verb]();
                eventStub.should.have.been.calledTwice;
                eventStub.should.have.been.calledWithExactly(true);
                eventStub.should.have.been.calledWithExactly(false);

                if (verb === 'start') {
                    runtime.getState().should.equal(FabricRuntimeState.STARTED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STARTING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);

                } else if (verb === 'stop' || verb === 'teardown') {
                    runtime.getState().should.equal(FabricRuntimeState.STOPPED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STOPPING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STOPPED);
                    stopLogsStub.should.have.been.called;
                }
            });

            it(`should publish busy events and set state before and after handling an error (Windows)`, async () => {
                sandbox.stub(process, 'platform').value('win32');
                const eventStub: sinon.SinonStub = sinon.stub();
                const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
                spawnStub.withArgs('cmd', ['/c', `${verb}.cmd`], sinon.match.any).callsFake(() => {
                    return mockFailureCommand();
                });
                runtime.on('busy', eventStub);

                if (verb === 'start') {
                    sandbox.stub(runtime, 'isRunning').resolves(false);
                } else {
                    sandbox.stub(runtime, 'isRunning').resolves(true);
                }

                await runtime[verb]().should.be.rejectedWith(`Failed to execute command "cmd" with  arguments "/c, ${verb}.cmd" return code 1`);
                eventStub.should.have.been.calledTwice;
                eventStub.should.have.been.calledWithExactly(true);
                eventStub.should.have.been.calledWithExactly(false);

                if (verb === 'start') {
                    runtime.getState().should.equal(FabricRuntimeState.STOPPED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STARTING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STOPPED);

                } else if (verb === 'stop' || verb === 'teardown') {
                    runtime.getState().should.equal(FabricRuntimeState.STARTED);
                    setStateSpy.should.have.been.calledTwice;
                    setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.STOPPING);
                    setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);
                    stopLogsStub.should.have.been.called;
                }
            });

        });
    });

    describe('#restart', () => {

        let stopLogsStub: sinon.SinonStub;

        beforeEach(() => {
            stopLogsStub = sandbox.stub(runtime, 'stopLogs');
        });

        it('should execute the start.sh and stop.sh scripts and handle success (Linux/MacOS)', async () => {
            sandbox.stub(process, 'platform').value('linux');
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('/bin/sh', ['start.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('/bin/sh', ['stop.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            await runtime.restart();
            spawnStub.should.have.been.calledTwice;
            spawnStub.should.have.been.calledWith('/bin/sh', ['start.sh'], sinon.match.any);
            spawnStub.should.have.been.calledWith('/bin/sh', ['stop.sh'], sinon.match.any);

            stopLogsStub.should.have.been.called;
        });

        it('should execute the start.sh and stop.sh scripts using a custom output adapter (Linux/MacOS)', async () => {
            sandbox.stub(process, 'platform').value('linux');
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('/bin/sh', ['start.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('/bin/sh', ['stop.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            const outputAdapter: sinon.SinonStubbedInstance<TestFabricOutputAdapter> = sinon.createStubInstance(TestFabricOutputAdapter);
            await runtime.restart(outputAdapter);
            outputAdapter.log.callCount.should.equal(4);

            outputAdapter.log.getCall(0).should.have.been.calledWith(LogType.INFO, undefined, 'stdout');
            outputAdapter.log.getCall(1).should.have.been.calledWith(LogType.INFO, undefined, 'stderr');
            outputAdapter.log.getCall(2).should.have.been.calledWith(LogType.INFO, undefined, 'stdout');
            outputAdapter.log.getCall(3).should.have.been.calledWith(LogType.INFO, undefined, 'stderr');
            stopLogsStub.should.have.been.called;
        });

        it('should publish busy events and set state before and after handling success (Linux/MacOS)', async () => {
            sandbox.stub(process, 'platform').value('linux');
            const eventStub: sinon.SinonStub = sinon.stub();
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('/bin/sh', ['start.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('/bin/sh', ['stop.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            runtime.on('busy', eventStub);
            sandbox.stub(runtime, 'isRunning').resolves(true);
            const setStateSpy: sinon.SinonSpy = sandbox.spy(runtime, 'setState');
            await runtime.restart();
            eventStub.should.have.been.calledTwice;
            eventStub.should.have.been.calledWithExactly(true);
            eventStub.should.have.been.calledWithExactly(false);

            setStateSpy.should.have.been.calledTwice;
            setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.RESTARTING);
            setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);
            runtime.getState().should.equal(FabricRuntimeState.STARTED);
            stopLogsStub.should.have.been.called;
        });

        it('should publish busy events and set state before and after handling an error, failure to stop (Linux/MacOS)', async () => {
            sandbox.stub(process, 'platform').value('linux');
            const eventStub: sinon.SinonStub = sinon.stub();
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('/bin/sh', ['start.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('/bin/sh', ['stop.sh'], sinon.match.any).callsFake(() => {
                return mockFailureCommand();
            });
            runtime.on('busy', eventStub);
            sandbox.stub(runtime, 'isRunning').resolves(true);
            const setStateSpy: sinon.SinonSpy = sandbox.spy(runtime, 'setState');
            await runtime.restart().should.be.rejectedWith(`Failed to execute command "/bin/sh" with  arguments "stop.sh" return code 1`);
            eventStub.should.have.been.calledTwice;
            eventStub.should.have.been.calledWithExactly(true);
            eventStub.should.have.been.calledWithExactly(false);

            setStateSpy.should.have.been.calledTwice;
            setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.RESTARTING);
            setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);
            runtime.getState().should.equal(FabricRuntimeState.STARTED);
            stopLogsStub.should.have.been.called;
        });

        it('should publish busy events and set state before and after handling an error, failure to start (Linux/MacOS)', async () => {
            sandbox.stub(process, 'platform').value('linux');
            const eventStub: sinon.SinonStub = sinon.stub();
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('/bin/sh', ['start.sh'], sinon.match.any).callsFake(() => {
                return mockFailureCommand();
            });
            spawnStub.withArgs('/bin/sh', ['stop.sh'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            runtime.on('busy', eventStub);
            sandbox.stub(runtime, 'isRunning').resolves(false);
            const setStateSpy: sinon.SinonSpy = sandbox.spy(runtime, 'setState');
            await runtime.restart().should.be.rejectedWith(`Failed to execute command "/bin/sh" with  arguments "start.sh" return code 1`);
            eventStub.should.have.been.calledTwice;
            eventStub.should.have.been.calledWithExactly(true);
            eventStub.should.have.been.calledWithExactly(false);

            setStateSpy.should.have.been.calledTwice;
            setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.RESTARTING);
            setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STOPPED);
            runtime.getState().should.equal(FabricRuntimeState.STOPPED);
            stopLogsStub.should.have.been.called;
        });

        it('should execute the start.cmd and stop.cmd scripts and handle success (Windows)', async () => {
            sandbox.stub(process, 'platform').value('win32');
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('cmd', ['/c', 'start.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('cmd', ['/c', 'stop.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            await runtime.restart();
            spawnStub.should.have.been.calledTwice;
            spawnStub.should.have.been.calledWith('cmd', ['/c', 'start.cmd'], sinon.match.any);
            spawnStub.should.have.been.calledWith('cmd', ['/c', 'stop.cmd'], sinon.match.any);
            stopLogsStub.should.have.been.called;
        });

        it('should execute the start.sh and stop.sh scripts using a custom output adapter (Windows)', async () => {
            sandbox.stub(process, 'platform').value('win32');
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('cmd', ['/c', 'start.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('cmd', ['/c', 'stop.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            const outputAdapter: sinon.SinonStubbedInstance<TestFabricOutputAdapter> = sinon.createStubInstance(TestFabricOutputAdapter);
            await runtime.restart(outputAdapter);
            outputAdapter.log.callCount.should.equal(4);
            outputAdapter.log.getCall(0).should.have.been.calledWith(LogType.INFO, undefined, 'stdout');
            outputAdapter.log.getCall(1).should.have.been.calledWith(LogType.INFO, undefined, 'stderr');
            outputAdapter.log.getCall(2).should.have.been.calledWith(LogType.INFO, undefined, 'stdout');
            outputAdapter.log.getCall(3).should.have.been.calledWith(LogType.INFO, undefined, 'stderr');
            stopLogsStub.should.have.been.called;
        });

        it('should publish busy events and set state before and after handling success (Windows)', async () => {
            sandbox.stub(process, 'platform').value('win32');
            const eventStub: sinon.SinonStub = sinon.stub();
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('cmd', ['/c', 'start.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('cmd', ['/c', 'stop.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            runtime.on('busy', eventStub);
            sandbox.stub(runtime, 'isRunning').resolves(true);
            const setStateSpy: sinon.SinonSpy = sandbox.spy(runtime, 'setState');
            await runtime.restart();
            eventStub.should.have.been.calledTwice;
            eventStub.should.have.been.calledWithExactly(true);
            eventStub.should.have.been.calledWithExactly(false);

            setStateSpy.should.have.been.calledTwice;
            setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.RESTARTING);
            setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);
            runtime.getState().should.equal(FabricRuntimeState.STARTED);
            stopLogsStub.should.have.been.called;
        });

        it('should publish busy events and set state before and after handling an error, on stopping (Windows)', async () => {
            sandbox.stub(process, 'platform').value('win32');
            const eventStub: sinon.SinonStub = sinon.stub();
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('cmd', ['/c', 'start.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            spawnStub.withArgs('cmd', ['/c', 'stop.cmd'], sinon.match.any).callsFake(() => {
                return mockFailureCommand();
            });
            runtime.on('busy', eventStub);
            sandbox.stub(runtime, 'isRunning').resolves(true);
            const setStateSpy: sinon.SinonSpy = sandbox.spy(runtime, 'setState');
            await runtime.restart().should.be.rejectedWith(`Failed to execute command "cmd" with  arguments "/c, stop.cmd" return code 1`);
            eventStub.should.have.been.calledTwice;
            eventStub.should.have.been.calledWithExactly(true);
            eventStub.should.have.been.calledWithExactly(false);

            setStateSpy.should.have.been.calledTwice;
            setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.RESTARTING);
            setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STARTED);
            runtime.getState().should.equal(FabricRuntimeState.STARTED);
            stopLogsStub.should.have.been.called;
        });

        it('should publish busy events and set state before and after handling an error, on starting (Windows)', async () => {
            sandbox.stub(process, 'platform').value('win32');
            const eventStub: sinon.SinonStub = sinon.stub();
            const spawnStub: sinon.SinonStub = sandbox.stub(child_process, 'spawn');
            spawnStub.withArgs('cmd', ['/c', 'start.cmd'], sinon.match.any).callsFake(() => {
                return mockFailureCommand();
            });
            spawnStub.withArgs('cmd', ['/c', 'stop.cmd'], sinon.match.any).callsFake(() => {
                return mockSuccessCommand();
            });
            runtime.on('busy', eventStub);
            sandbox.stub(runtime, 'isRunning').resolves(false);
            const setStateSpy: sinon.SinonSpy = sandbox.spy(runtime, 'setState');
            await runtime.restart().should.be.rejectedWith(`Failed to execute command "cmd" with  arguments "/c, start.cmd" return code 1`);
            eventStub.should.have.been.calledTwice;
            eventStub.should.have.been.calledWithExactly(true);
            eventStub.should.have.been.calledWithExactly(false);

            setStateSpy.should.have.been.calledTwice;
            setStateSpy.firstCall.should.have.been.calledWith(FabricRuntimeState.RESTARTING);
            setStateSpy.secondCall.should.have.been.calledWith(FabricRuntimeState.STOPPED);
            runtime.getState().should.equal(FabricRuntimeState.STOPPED);
            stopLogsStub.should.have.been.called;
        });
    });

    describe('#isCreated', () => {

        it('should return true if the peer, orderer, CA, couchdb, and logs exist', async () => {
            await runtime.isCreated().should.eventually.be.true;
        });

        it('should return true if the peer does not exist, but everything else does', async () => {
            mockPeerVolume.inspect.rejects(new Error('blah'));
            await runtime.isCreated().should.eventually.be.true;
        });

        it('should return true if the orderer does not exist, but everything else does', async () => {
            mockOrdererVolume.inspect.rejects(new Error('blah'));
            await runtime.isCreated().should.eventually.be.true;
        });

        it('should return true if the CA does not exist, but everything else does', async () => {
            mockCAVolume.inspect.rejects(new Error('blah'));
            await runtime.isCreated().should.eventually.be.true;
        });

        it('should return true if Couch does not exist, but everything else does', async () => {
            mockCouchVolume.inspect.rejects(new Error('blah'));
            await runtime.isCreated().should.eventually.be.true;
        });

        it('should return true if logs does not exist, but everything else does', async () => {
            mockLogsVolume.inspect.rejects(new Error('blah'));
            await runtime.isCreated().should.eventually.be.true;
        });

        it('should return false if nothing exists', async () => {
            mockPeerVolume.inspect.rejects(new Error('blah'));
            mockOrdererVolume.inspect.rejects(new Error('blah'));
            mockCAVolume.inspect.rejects(new Error('blah'));
            mockCouchVolume.inspect.rejects(new Error('blah'));
            mockLogsVolume.inspect.rejects(new Error('blah'));
            await runtime.isCreated().should.eventually.be.false;
        });
    });

    describe('#isRunning', () => {

        it('should return true if the peer, orderer, CA, Couch and Logs are running', async () => {
            await runtime.isRunning().should.eventually.be.true;
        });

        it('should return false if the peer does not exist', async () => {
            mockPeerContainer.inspect.rejects(new Error('blah'));
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if the peer is not running', async () => {
            mockPeerInspect.State.Running = false;
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if the orderer does not exist', async () => {
            mockOrdererContainer.inspect.rejects(new Error('blah'));
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if the orderer is not running', async () => {
            mockOrdererInspect.State.Running = false;
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if the CA does not exist', async () => {
            mockCAContainer.inspect.rejects(new Error('blah'));
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if the CA is not running', async () => {
            mockCAInspect.State.Running = false;
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if Couch does not exist', async () => {
            mockCouchContainer.inspect.rejects(new Error('blah'));
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if Couch is not running', async () => {
            mockCouchInspect.State.Running = false;
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if Logs does not exist', async () => {
            mockLogsContainer.inspect.rejects(new Error('blah'));
            await runtime.isRunning().should.eventually.be.false;
        });

        it('should return false if Logs is not running', async () => {
            mockLogsInspect.State.Running = false;
            await runtime.isRunning().should.eventually.be.false;
        });

    });

    describe('#isDevelopmentMode', () => {

        it('should return false if the runtime is in development mode', () => {
            runtime.developmentMode = false;
            runtime.isDevelopmentMode().should.be.false;
        });

        it('should return true if the runtime is in development mode', () => {
            runtime.developmentMode = true;
            runtime.isDevelopmentMode().should.be.true;
        });
    });

    describe('#setDevelopmentMode', () => {
        it('should set the runtime development mode to false', async () => {
            await runtime.setDevelopmentMode(false);
            runtime.developmentMode.should.be.false;
        });

        it('should set the runtime development mode to true', async () => {
            await runtime.setDevelopmentMode(true);
            runtime.developmentMode.should.be.true;
        });
    });

    describe('#getChaincodeAddress', () => {
        it('should get the chaincode address', async () => {
            const result: string = await runtime.getChaincodeAddress();
            result.should.equal('localhost:54321');
        });
    });

    describe('#getLogsAddress', () => {
        it('should get the logs address', async () => {
            const result: string = await runtime.getLogsAddress();
            result.should.equal('localhost:12387');
        });
    });

    describe('#getPeerContainerName', () => {
        it('should get the chaincode address', () => {
            const result: string = runtime.getPeerContainerName();
            result.should.equal('fabricvscodelocalfabric_peer0.org1.example.com');
        });
    });

    describe('#exportConnectionProfile', () => {

        beforeEach(async () => {
            connectionProfilePath = path.join(runtimeDir, FabricRuntimeUtil.LOCAL_FABRIC, 'connection.json');
            errorSpy = sandbox.spy(VSCodeBlockchainOutputAdapter.instance(), 'log');
        });

        it('should save runtime connection profile to disk', async () => {
            await runtime.exportConnectionProfile(VSCodeBlockchainOutputAdapter.instance());
            ensureFileStub.should.have.been.calledOnceWithExactly(connectionProfilePath);
            writeFileStub.should.have.been.calledOnce;
            errorSpy.should.not.have.been.called;
        });

        it('should save runtime connection profile to a specified place', async () => {
            runtimeDir = 'myPath';
            connectionProfilePath = path.join(runtimeDir, FabricRuntimeUtil.LOCAL_FABRIC, 'connection.json');

            await runtime.exportConnectionProfile(VSCodeBlockchainOutputAdapter.instance(), 'myPath');
            ensureFileStub.should.have.been.calledOnceWithExactly(connectionProfilePath);
            writeFileStub.should.have.been.calledOnce;
            errorSpy.should.not.have.been.called;
        });

        it('should show an error message if we fail to save connection details to disk', async () => {
            writeFileStub.onCall(0).rejects({ message: 'oops' });

            await runtime.exportConnectionProfile(VSCodeBlockchainOutputAdapter.instance()).should.have.been.rejected;
            ensureFileStub.should.have.been.calledOnceWithExactly(connectionProfilePath);
            writeFileStub.should.have.been.calledOnce;
            errorSpy.should.have.been.calledWith(LogType.ERROR, `Issue saving runtime connection profile in directory ${path.join(runtimeDir, FabricRuntimeUtil.LOCAL_FABRIC)} with error: oops`);
        });
    });

    describe('#deleteConnectionDetails', () => {

        beforeEach(async () => {
            errorSpy = sandbox.spy(VSCodeBlockchainOutputAdapter.instance(), 'log');

        });

        it('should delete admin identity and local runtime ops connection details ', async () => {
            await runtime.deleteConnectionDetails(VSCodeBlockchainOutputAdapter.instance());

            removeStub.getCall(0).should.have.been.calledWith(path.join(runtimeDir, FabricRuntimeUtil.LOCAL_FABRIC));
            removeStub.getCall(1).should.have.been.calledWith(path.join(runtimeDir, FabricWalletUtil.LOCAL_WALLET, FabricRuntimeUtil.ADMIN_USER));
            removeStub.getCall(2).should.have.been.calledWith(path.join(runtimeDir, FabricWalletUtil.LOCAL_WALLET + '-ops'));
            errorSpy.should.not.have.been.called;
        });

        it('should show an error message if we fail to delete the connection details', async () => {
            removeStub.onCall(0).rejects({ message: 'oops' });

            await runtime.deleteConnectionDetails(VSCodeBlockchainOutputAdapter.instance());
            errorSpy.should.have.been.calledWith(LogType.ERROR, `Error removing runtime connection details: oops`), `Error removing runtime connection details: oops`;
        });

        it('should not show an error message if the runtime connection details folder doesnt exist', async () => {
            removeStub.onCall(0).rejects({ message: 'ENOENT: no such file or directory' });

            await runtime.deleteConnectionDetails(VSCodeBlockchainOutputAdapter.instance());
            errorSpy.should.not.have.been.called;
        });
    });

    describe('#startLogs', () => {

        it('should start the logs', async () => {
            const sendRequest: sinon.SinonStub = sandbox.stub(CommandUtil, 'sendRequestWithOutput');

            await runtime.startLogs(VSCodeBlockchainDockerOutputAdapter.instance());

            sendRequest.should.have.been.calledWith('http://localhost:12387/logs', VSCodeBlockchainDockerOutputAdapter.instance());
        });
    });

    describe('#stopLogs', () => {
        it('should stop the logs', () => {
            const abortRequestStub: sinon.SinonStub = sandbox.stub(CommandUtil, 'abortRequest');

            runtime['logsRequest'] = { abort: sandbox.stub() };
            runtime.stopLogs();

            abortRequestStub.should.have.been.calledWith(runtime['logsRequest']);
        });

        it('should not stop the logs if no request', () => {
            const abortRequestStub: sinon.SinonStub = sandbox.stub(CommandUtil, 'abortRequest');

            runtime.stopLogs();

            abortRequestStub.should.not.have.been.called;
        });
    });

    describe('#getGateways', () => {
        it('should return an array of gateways', async () => {
            const gateways: FabricGateway[] = await runtime.getGateways();
            gateways.should.deep.equal([
                {
                    name: FabricRuntimeUtil.LOCAL_FABRIC,
                    path: runtime['getConnectionProfilePath'](),
                    connectionProfile: {
                        name: 'basic-network',
                        version: '1.0.0',
                        client: {
                            organization: 'Org1',
                            connection: {
                                timeout: {
                                    peer: {
                                        endorser: '300',
                                        eventHub: '300',
                                        eventReg: '300'
                                    },
                                    orderer: '300'
                                }
                            }
                        },
                        channels: {
                            mychannel: {
                                orderers: [
                                    'orderer.example.com'
                                ],
                                peers: {
                                    'peer0.org1.example.com': {}
                                }
                            }
                        },
                        organizations: {
                            Org1: {
                                mspid: 'Org1MSP',
                                peers: [
                                    'peer0.org1.example.com'
                                ],
                                certificateAuthorities: [
                                    'ca.org1.example.com'
                                ]
                            }
                        },
                        orderers: {
                            'orderer.example.com': {
                                url: 'grpc://127.0.0.1:12347'
                            }
                        },
                        peers: {
                            'peer0.org1.example.com': {
                                url: 'grpc://localhost:12345',
                                eventUrl: 'grpc://localhost:12346'
                            }
                        },
                        certificateAuthorities: {
                            'ca.org1.example.com': {
                                url: 'http://127.0.0.1:12348',
                                caName: 'ca.example.com'
                            }
                        }
                    }
                }
            ]);
        });
    });

    describe('#getNodes', () => {
        it('should return an array of nodes', async () => {
            const nodes: FabricNode[] = await runtime.getNodes();
            nodes.should.deep.equal([
                {
                    short_name: 'peer0.org1.example.com',
                    name: 'peer0.org1.example.com',
                    type: 'fabric-peer',
                    url: 'grpc://localhost:12345',
                    wallet: `${FabricWalletUtil.LOCAL_WALLET}-ops`,
                    identity: FabricRuntimeUtil.ADMIN_USER,
                    msp_id: 'Org1MSP'
                },
                {
                    short_name: 'ca.example.com',
                    name: 'ca.example.com',
                    type: 'fabric-ca',
                    url: 'http://localhost:12348',
                    wallet: FabricWalletUtil.LOCAL_WALLET,
                    identity: FabricRuntimeUtil.ADMIN_USER,
                    msp_id: 'Org1MSP'
                },
                {
                    short_name: 'orderer.example.com',
                    name: 'orderer.example.com',
                    type: 'fabric-orderer',
                    url: 'grpc://localhost:12347',
                    wallet: `${FabricWalletUtil.LOCAL_WALLET}-ops`,
                    identity: FabricRuntimeUtil.ADMIN_USER,
                    msp_id: 'OrdererMSP'
                }
            ]);
        });
    });

    describe('#getWalletName', () => {
        it('should return an array of wallet names', async () => {
            const walletNames: string[] = await runtime.getWalletNames();
            walletNames.should.deep.equal([
                `${FabricWalletUtil.LOCAL_WALLET}-ops`
            ]);
        });
    });

    describe('#getIdentities', () => {
        it('should return an array of identities for a wallet that exists', async () => {
            const identities: FabricIdentity[] = await runtime.getIdentities(`${FabricWalletUtil.LOCAL_WALLET}-ops`);
            let certificate: string;
            let privateKey: string;
            if (os.platform() === 'win32') {
                certificate = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tDQpNSUlDR0RDQ0FiK2dBd0lCQWdJUUZTeG5MQUdzdTA0enJGa0FFd3puNnpBS0JnZ3Foa2pPUFFRREFqQnpNUXN3DQpDUVlEVlFRR0V3SlZVekVUTUJFR0ExVUVDQk1LUTJGc2FXWnZjbTVwWVRFV01CUUdBMVVFQnhNTlUyRnVJRVp5DQpZVzVqYVhOamJ6RVpNQmNHQTFVRUNoTVFiM0puTVM1bGVHRnRjR3hsTG1OdmJURWNNQm9HQTFVRUF4TVRZMkV1DQpiM0puTVM1bGVHRnRjR3hsTG1OdmJUQWVGdzB4TnpBNE16RXdPVEUwTXpKYUZ3MHlOekE0TWprd09URTBNekphDQpNRnN4Q3pBSkJnTlZCQVlUQWxWVE1STXdFUVlEVlFRSUV3cERZV3hwWm05eWJtbGhNUll3RkFZRFZRUUhFdzFUDQpZVzRnUm5KaGJtTnBjMk52TVI4d0hRWURWUVFEREJaQlpHMXBia0J2Y21jeExtVjRZVzF3YkdVdVkyOXRNRmt3DQpFd1lIS29aSXpqMENBUVlJS29aSXpqMERBUWNEUWdBRVYxZGZtS3hzRktXbzdvNkROQklhSVZlYkNDUEFNOUMvDQpzTEJ0NHBKUnJlOXBXRTk4N0RqWFpvWjNnbGM0K0RvUE10VG1CUnFiUFZ3WWNVdnBiWVk4cDZOTk1Fc3dEZ1lEDQpWUjBQQVFIL0JBUURBZ2VBTUF3R0ExVWRFd0VCL3dRQ01BQXdLd1lEVlIwakJDUXdJb0FnUWptcURjMTIydTY0DQp1Z3phY0JoUjBVVUUweHF0R3kzZDI2eHFWelplU1h3d0NnWUlLb1pJemowRUF3SURSd0F3UkFJZ1hNeTI2QUVVDQovR1VNUGZDTXMvblFqUU1FMVp4QkhBWVp0S0V1UlIzNjFKc0NJRWc5Qk9aZElvaW9SaXZKQytaVXp2SlVua1h1DQpvMkhrV2l1eExzaWJHeHRFDQotLS0tLUVORCBDRVJUSUZJQ0FURS0tLS0tDQo=';
                privateKey = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tDQpNSUdIQWdFQU1CTUdCeXFHU000OUFnRUdDQ3FHU000OUF3RUhCRzB3YXdJQkFRUWdSZ1FyMzQ3aWo2Y2p3WDdtDQpLanpiYkQ4VGx3ZGZ1NkZhdWJqV0pXTEd5cWFoUkFOQ0FBUlhWMStZckd3VXBhanVqb00wRWhvaFY1c0lJOEF6DQowTCt3c0czaWtsR3Q3MmxZVDN6c09OZG1obmVDVnpqNE9nOHkxT1lGR3BzOVhCaHhTK2x0aGp5bg0KLS0tLS1FTkQgUFJJVkFURSBLRVktLS0tLQ0K';
            } else {
                certificate = 'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUNHRENDQWIrZ0F3SUJBZ0lRRlN4bkxBR3N1MDR6ckZrQUV3em42ekFLQmdncWhrak9QUVFEQWpCek1Rc3cKQ1FZRFZRUUdFd0pWVXpFVE1CRUdBMVVFQ0JNS1EyRnNhV1p2Y201cFlURVdNQlFHQTFVRUJ4TU5VMkZ1SUVaeQpZVzVqYVhOamJ6RVpNQmNHQTFVRUNoTVFiM0puTVM1bGVHRnRjR3hsTG1OdmJURWNNQm9HQTFVRUF4TVRZMkV1CmIzSm5NUzVsZUdGdGNHeGxMbU52YlRBZUZ3MHhOekE0TXpFd09URTBNekphRncweU56QTRNamt3T1RFME16SmEKTUZzeEN6QUpCZ05WQkFZVEFsVlRNUk13RVFZRFZRUUlFd3BEWVd4cFptOXlibWxoTVJZd0ZBWURWUVFIRXcxVApZVzRnUm5KaGJtTnBjMk52TVI4d0hRWURWUVFEREJaQlpHMXBia0J2Y21jeExtVjRZVzF3YkdVdVkyOXRNRmt3CkV3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFVjFkZm1LeHNGS1dvN282RE5CSWFJVmViQ0NQQU05Qy8Kc0xCdDRwSlJyZTlwV0U5ODdEalhab1ozZ2xjNCtEb1BNdFRtQlJxYlBWd1ljVXZwYllZOHA2Tk5NRXN3RGdZRApWUjBQQVFIL0JBUURBZ2VBTUF3R0ExVWRFd0VCL3dRQ01BQXdLd1lEVlIwakJDUXdJb0FnUWptcURjMTIydTY0CnVnemFjQmhSMFVVRTB4cXRHeTNkMjZ4cVZ6WmVTWHd3Q2dZSUtvWkl6ajBFQXdJRFJ3QXdSQUlnWE15MjZBRVUKL0dVTVBmQ01zL25RalFNRTFaeEJIQVladEtFdVJSMzYxSnNDSUVnOUJPWmRJb2lvUml2SkMrWlV6dkpVbmtYdQpvMkhrV2l1eExzaWJHeHRFCi0tLS0tRU5EIENFUlRJRklDQVRFLS0tLS0K';
                privateKey = 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5QXdFSEJHMHdhd0lCQVFRZ1JnUXIzNDdpajZjandYN20KS2p6YmJEOFRsd2RmdTZGYXVialdKV0xHeXFhaFJBTkNBQVJYVjErWXJHd1VwYWp1am9NMEVob2hWNXNJSThBegowTCt3c0czaWtsR3Q3MmxZVDN6c09OZG1obmVDVnpqNE9nOHkxT1lGR3BzOVhCaHhTK2x0aGp5bgotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tCg==';
            }
            identities.should.deep.equal([
                {
                    name: FabricRuntimeUtil.ADMIN_USER,
                    certificate: certificate,
                    private_key: privateKey,
                    msp_id: 'Org1MSP'
                }
            ]);
        });

        it('should throw for a wallet that does not exist', async () => {
            await runtime.getIdentities('no identities here').should.be.rejectedWith(/does not exist/);
        });
    });

});
