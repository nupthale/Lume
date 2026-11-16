import { ISpec } from '@visactor/vchart';

export const useExtendChartProps = () => {
    const extendUserProps = (userProps: ISpec, crtView: string): ISpec => {
        if (!userProps) {
            return {} as ISpec;
        }
    
        // const type = userProps.type;
    
        let baseProps: Partial<ISpec> = {
            // height: 520,
            autoFit: true,
        };

        if ((userProps as any).seriesField) {
            baseProps.legends = [{ 
                visible: true, 
                position: 'start', 
                orient: 'top', 
                noOuterPadding: true, 
                offsetY: -10,
                offsetX: -8,
                padding: [0, 0, 8, 0],
                item: {
                    padding: [4, 8],
                },
                interactive: true,
            }];
        }

        let typeProps: Partial<ISpec> = {};
    
        switch(crtView) {
            case 'bar': 
                typeProps = {
                    barMaxWidth: 40,
                    bar: {
                        style: {
                            cornerRadius: 1,
                        }
                    }
                };
    
                break;
        }

        return {
            ...baseProps,
            ...userProps,
            ...typeProps,
        } as ISpec;
    }

    return {
        extendUserProps,
    };
}